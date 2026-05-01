export const audiModule = {
  id: "audi",
  title: "Vehicle — Audi",
  mount(el) {
    el.innerHTML = `
      <div class="zee-audi">
        <div class="zee-audi-visual-frame">
          <img
            src="/api/zee/audi/image"
            alt="Audi render"
            class="zee-audi-photo"
            loading="lazy"
            onerror="this.onerror=null;this.src='/zee/assets/audi.svg';this.classList.add('zee-audi-fallback');"
          />
        </div>
        <div class="zee-audi-stats">
          <div class="zee-stat"><span class="zee-stat-label">Mileage</span><span class="zee-stat-value zee-dim">— connect OBD / manual entry</span></div>
          <div class="zee-stat"><span class="zee-stat-label">Fuel</span><span class="zee-stat-value zee-dim">— future module</span></div>
        </div>
      </div>
    `;
    return {};
  },
};
