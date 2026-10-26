# California sales tax on website orders

Last checked: 2026-10-07. Applies to preeminentstore.com checkout (PayPal, Zelle, Venmo).
TCGplayer and eBay collect and remit tax themselves as marketplace facilitators; this doc is only about our own site.

## The rule we follow

The PreEminent Store LLC holds a CDTFA seller's permit and ships from one location in Riverside County.

| Ship-to address | Rate charged | Why |
| --- | --- | --- |
| Outside California | 0% | Interstate sale; not subject to California sales/use tax. |
| California, outside the districts we're engaged in business in | 7.25% statewide rate | Pub 105: if you are not engaged in business in a district you may use the statewide rate; the buyer owes any district use tax. |
| California, inside Riverside County (RCTC district) | 7.75% (7.25% + 0.50%) | We are engaged in business in this district (physical location), so we collect its district use tax on deliveries into it (Reg 1827(c)(1)). |
| California, inside the city district where the business is located | 8.75% (7.25% + 0.50% + 1.00%) | Same reason; that city's 1.00% transactions and use tax became operative 2026-10-01 (CDTFA L-1037). |

We are only "engaged in business" in the districts where we have a physical presence. Under the 2019 Wayfair rules,
a retailer with more than $500,000 of California sales in the current or prior year is engaged in business in every
district and must collect every district's tax. If sales ever cross that, switch to full per-address rates
(CDTFA's rate lookup), not this table.

Tax is charged on the merchandise subtotal. Shipping is not taxed at checkout (see below).

### Shipping

A separately stated delivery charge for shipment directly to the buyer by USPS or another common carrier is not
taxable, **but only up to our actual cost** for that shipment, and only if records show the actual cost. If the flat
charge is more than the postage, the excess is taxable; averaging across orders is not allowed (Reg 1628(a),
Pub 100, Annotation 557.0003). A charge labeled "shipping and handling" is fully taxable unless split; ours is labeled
"Shipping".

What we do: buyers are charged tax on merchandise only (`taxShipping: false`). This matches the CDTFA staff's own
note that charging tax only on the item is allowed as long as the seller still pays tax to the state on any taxable
part of the delivery charge (Annotation 557.0690). So on the return:

- Deduct CA shipping as nontaxable only up to the postage actually paid for each package (keep the label receipts).
- Any amount where our flat charge ($10.99 sealed, $1.49 singles) was more than that package's postage is taxable,
  and we pay that tax ourselves.
- Envelopes, top loaders, and boxes are our cost. They are never part of the nontaxable delivery charge.

If most packages cost more to ship than we charge, there is nothing extra to report. If not, either set
`taxShipping: true` (tax the whole shipping charge at checkout) or keep paying the small difference ourselves.

### Rounding and display

Tax = round(taxable amount × combined rate) to the cent, per order. Buyers see one line, e.g.
"Sales tax (CA 8.75%)". Public pages, emails, and receipts never name the city or district.

### Which district an address is in

ZIP codes do not follow city or county lines (parts of the city's ZIPs are unincorporated county land, e.g. Mead
Valley). So when we have a street address, membership comes from CDTFA's free official rate lookup,
`https://services.maps.cdtfa.ca.gov/api/taxrate/GetRateByAddress?address=&city=&zip=`, called server-side from the
Cloudflare functions:

- Its answer (`taxRateInfo[0].city` / `.county`) only decides membership: county `RIVERSIDE` → RCTC 0.50%;
  city equal to our city → also the city's 1.00%. `UNINCORPORATED` gets the county district only. We never use
  CDTFA's `rate` field, so other districts' taxes are never charged (an SF address is still 7.25%).
- Only exact geocodes are trusted (`geocodeInfo.confidence` "High"). A fuzzy street match can land on a different
  address, so anything else counts as a failed lookup.
- Timeout 2 s. Results are cached in KV for 30 days (`taxaddr:<STREET|CITY|ZIP5>`); failures are not cached.
- If the lookup errors, times out, or isn't exact, we fall back to the ZIP lists and log
  `[sales-tax] CDTFA lookup failed (...) for ZIP ...; using city + ZIP lists` (Cloudflare Pages → Functions logs).

ZIP lists (fallback, and the PayPal estimate before PayPal gives us the street):

- RCTC (0.50%): every ZIP that is wholly or mostly in Riverside County. 92028 (Fallbrook), 92324 (Colton), and
  92373 (Redlands) are left out because they are mostly in other counties.
- City district (1.00%): the city's four ZIPs, **and** the mailing city must be our city name. A Mead Valley mailing
  address in a shared ZIP is 7.75%; an unincorporated address that still uses our city as its mailing city is
  over-charged 1% in fallback only. Tax collected in error must be paid to CDTFA or refunded to the buyer (Rev. &
  Tax. Code 6901.5); orders keep `taxInfo.source` so fallback orders are easy to find.

## Where it lives

- Config: `data/store-settings.json` → `salesTax`
  `{ enabled, state: "CA", baseRate: 0.0725, taxShipping: false, addressLookup: { enabled, url, timeoutMs, cacheDays },
  districts: [{ name, rate, lookup: { county } | { city }, zips: [...] }] }`. `addressLookup.enabled: false` turns
  the CDTFA call off (ZIP lists only).
  The portal pushes it to Cloudflare KV inside `stock` (private) on every publish; edit it there, then publish.
- Math: `cloudflare/lib/salesTax.js` (`salesTaxFor`), used by every checkout function. The browser never sends a
  price or a tax amount.
- PayPal: the order starts with `tax_total` 0. When the buyer picks or changes an address in the PayPal window,
  `onShippingAddressChange` calls `/api/paypal/shipping-change`, which re-prices for that address and PATCHes the
  PayPal order amount (`breakdown.tax_total`). That callback has no street, so it is an estimate from city name +
  ZIP lists. `/api/paypal/capture-order` recomputes from PayPal's final full ship-to address (CDTFA lookup) before
  capturing. If the exact tax is lower (e.g. unincorporated address), the order is patched down and captured. If it
  is higher (or the callback never ran, as in some card/Venmo flows), nothing is charged: the buyer sees the
  corrected total and a "Pay $X" button, and the order is patched only after they confirm.
- Zelle/Venmo: the full address is entered on the site; `/api/quote` shows the tax as they type (street, city,
  state, ZIP) and `/api/manual/create-order` charges it. The amount to send, the Venmo pay link, and both emails
  include it.
- Orders store `tax` (dollars) and `taxInfo { state, zip, rate, taxable, districts, source }`; `total` includes tax.
  `source`: `address` / `address-cached` (CDTFA), `zip-fallback` (lookup failed), `zip` (no street), `none`.

## Books

- Sales tax is a liability, not income. The Sold 2026 row uses line prices + shipping only, as before; tax is not
  written to the sheet.
- PayPal and Venmo fees are charged on the full amount paid, including tax. That fee is a real cost, so it stays in
  the Fees column.
- Monthly totals for the return: portal → Marketing → "California sales tax", or
  `GET /api/store/sales-tax?from=YYYY-MM-DD&to=YYYY-MM-DD` (`&format=csv` to download). Per month: total sales
  excluding tax (return line 1), out-of-state sales (interstate deduction), CA taxable sales, CA shipping charged,
  tax collected, taxable sales per district (Schedule A), plus CA orders paid before tax collection started (the
  seller still owes tax on those).

## Sources

- CDTFA Publication 105, District Taxes and Sales Delivered in California: https://www.cdtfa.ca.gov/formspubs/pub105/basic-rules.htm and https://cdtfa.ca.gov/formspubs/pub105/special-situations.htm
- Regulation 1827, Collection of Use Tax by Retailers: https://www.cdtfa.ca.gov/lawguides/vol1/tutr/1827.html
- Regulation 1823.4 (out-of-district delivery declaration): https://cdtfa.ca.gov/lawguides/vol1/tutr/1823-4.html
- CDTFA L-1037, New Sales and Use Tax Rates Operative October 1, 2026: https://cdtfa.ca.gov/formspubs/L1037.pdf
- CDTFA-105, District Sales and Use Tax Rates: https://cdtfa.ca.gov/formspubs/cdtfa105.pdf
- CDTFA-95, Sales and Use Tax Rates by County and City (operative 2026-10-01): https://cdtfa.ca.gov/taxes-and-fees/TaxRatesbyCountyandCity.pdf
- City and county rate table: https://cdtfa.ca.gov/taxes-and-fees/rates.aspx
- Regulation 1628, Transportation Charges: https://cdtfa.ca.gov/lawguides/vol1/sutr/1628.html
- Publication 100, Shipping and Delivery Charges: https://cdtfa.ca.gov/formspubs/pub100/applying-sales-tax.htm
- Annotations 557.0003 (no averaging) and 557.0690 (flat charges): https://www.cdtfa.ca.gov/lawguides/vol2/suta/557-0003.html, https://cdtfa.ca.gov/lawguides/annotations/557-0690.pdf

## Keeping it current

CDTFA changes district rates on January 1, April 1, July 1, and October 1 and mails a notice beforehand. Check
L-notices and the rate table each quarter, update `salesTax` in `data/store-settings.json`, set `ratesCheckedAt`,
and publish.
