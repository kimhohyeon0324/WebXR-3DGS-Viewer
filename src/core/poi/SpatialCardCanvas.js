import * as THREE from 'three';

/**
 * VR 3D 공간 정보 카드용 HTML5 2D Canvas 텍스처 팩토리
 * 텍스트 래핑, 글래스모피즘 배경, 네온 뱃지 등 2D 그래픽스 전담 렌더러
 */
export class SpatialCardCanvas {
  constructor(width = 512, height = 256) {
    this.width = width;
    this.height = height;

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.ctx = this.canvas.getContext('2d');

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
  }

  getTexture() {
    return this.texture;
  }

  /**
   * POI 메타데이터를 2D Canvas에 렌더링하고 Three.js 텍스처 갱신 플래그 설정
   */
  renderCard(poiData = {}) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    ctx.clearRect(0, 0, w, h);

    // 1. 반투명 글래스모피즘 배경
    ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
    this._roundRect(ctx, 4, 4, w - 8, h - 8, 20);
    ctx.fill();

    // 2. 테두리 네온 라인
    const isHaptic = poiData.type === 'haptic';
    ctx.strokeStyle = isHaptic ? 'rgba(245, 158, 11, 0.9)' : 'rgba(0, 240, 255, 0.9)';
    ctx.lineWidth = 4;
    this._roundRect(ctx, 4, 4, w - 8, h - 8, 20);
    ctx.stroke();

    // 3. 타입 뱃지
    const badgeColor = isHaptic ? '#f59e0b' : '#00f0ff';
    ctx.fillStyle = badgeColor;
    this._roundRect(ctx, 24, 22, isHaptic ? 90 : 80, 28, 6);
    ctx.fill();

    ctx.fillStyle = '#0a0e17';
    ctx.font = 'bold 15px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText((poiData.type || 'POI').toUpperCase(), isHaptic ? 69 : 64, 36);

    // 4. 타이틀
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 22px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(poiData.title || 'POI Metadata', 120, 36);

    // 5. 구분선
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(24, 62);
    ctx.lineTo(w - 24, 62);
    ctx.stroke();

    // 6. 3D 좌표 정보
    const coordStr = poiData.coordinates
      ? `(${poiData.coordinates.x.toFixed(3)}, ${poiData.coordinates.y.toFixed(3)}, ${poiData.coordinates.z.toFixed(3)})`
      : 'N/A';
    ctx.fillStyle = '#94a3b8';
    ctx.font = '14px monospace';
    ctx.fillText(`3D POS: ${coordStr}`, 24, 84);

    // 7. 설명문 본문 (자동 줄바꿈)
    ctx.fillStyle = '#e2e8f0';
    ctx.font = '16px sans-serif';
    this._wrapText(ctx, poiData.description || '', 24, 116, w - 48, 24);

    this.texture.needsUpdate = true;
  }

  _roundRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  _wrapText(ctx, text, x, y, maxWidth, lineHeight) {
    let line = '';
    let currentY = y;
    for (let i = 0; i < text.length; i++) {
      const testLine = line + text[i];
      const metrics = ctx.measureText(testLine);
      if (metrics.width > maxWidth && i > 0) {
        ctx.fillText(line, x, currentY);
        line = text[i];
        currentY += lineHeight;
        if (currentY > 230) {
          ctx.fillText(line + '...', x, currentY);
          return;
        }
      } else {
        line = testLine;
      }
    }
    ctx.fillText(line, x, currentY);
  }

  /**
   * WebGL 텍스처 및 Canvas 메모리 명시적 해제
   */
  dispose() {
    if (this.texture) {
      this.texture.dispose();
      this.texture = null;
    }
    this.canvas = null;
    this.ctx = null;
  }
}
