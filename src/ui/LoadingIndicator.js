/**
 * 3DGS 씬 스트리밍 및 파싱 진행률 게이지 제어
 */
export class LoadingIndicator {
  constructor() {
    this.overlay = document.getElementById('loading-overlay');
    this.progressBar = document.getElementById('progress-bar');
    this.statusText = document.getElementById('loading-status-text');
    this.percentageText = document.getElementById('loading-percentage');
  }

  show(initialMessage = '가우시안 데이터 다운로드 및 버퍼 파싱...') {
    if (this.overlay) {
      this.overlay.classList.remove('hidden');
    }
    this.updateProgress(0, initialMessage);
  }

  updateProgress(percent, message = null) {
    const clamped = Math.max(0, Math.min(100, Math.round(percent)));
    if (this.progressBar) {
      this.progressBar.style.width = `${clamped}%`;
    }
    if (this.percentageText) {
      this.percentageText.textContent = `${clamped}%`;
    }
    if (message && this.statusText) {
      this.statusText.textContent = message;
    }
  }

  hide() {
    if (this.overlay) {
      this.overlay.classList.add('hidden');
    }
  }
}
