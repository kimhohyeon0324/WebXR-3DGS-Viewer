/**
 * 3D POI(Point of Interest) 메타데이터 정보 카드 UI
 */
export class POICard {
  constructor() {
    this.element = document.createElement('div');
    this.element.id = 'poi-card';
    this.element.className = 'poi-card hidden';
    document.body.appendChild(this.element);

    this.onClose = null;
  }

  /**
   * 카드 내용 표시
   * @param {Object} poiData - { id, title, type, coordinates, description }
   * @param {Function} [onCloseCallback]
   */
  show(poiData, onCloseCallback = null) {
    this.onClose = onCloseCallback;

    const typeBadgeColors = {
      haptic: 'linear-gradient(135deg, #f59e0b, #ef4444)',
      audio: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
      visual: 'linear-gradient(135deg, #10b981, #06b6d4)',
      metadata: 'linear-gradient(135deg, #00f0ff, #3b82f6)'
    };

    const typeColor = typeBadgeColors[poiData.type] || typeBadgeColors.metadata;
    const typeLabel = (poiData.type || 'METADATA').toUpperCase();

    const coordStr = poiData.coordinates
      ? `(${poiData.coordinates.x.toFixed(2)}, ${poiData.coordinates.y.toFixed(2)}, ${poiData.coordinates.z.toFixed(2)})`
      : 'N/A';

    this.element.innerHTML = `
      <div class="poi-card-header">
        <div class="poi-type-badge" style="background: ${typeColor}">${typeLabel}</div>
        <button id="poi-card-close" class="poi-close-btn" title="닫기">&times;</button>
      </div>
      <h3 class="poi-title">${poiData.title}</h3>
      <div class="poi-meta-row">
        <span class="poi-meta-label">3D Coordinates:</span>
        <span class="poi-meta-value">${coordStr}</span>
      </div>
      <p class="poi-desc">${poiData.description}</p>
    `;

    const closeBtn = this.element.querySelector('#poi-card-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        this.hide();
      });
    }

    this.element.classList.remove('hidden');
  }

  hide() {
    this.element.classList.add('hidden');
    if (typeof this.onClose === 'function') {
      this.onClose();
    }
  }
}
