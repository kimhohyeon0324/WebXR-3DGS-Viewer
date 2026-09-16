import { PRESET_MODELS, DEFAULT_MODEL_KEY } from '../data/modelPresets.js';
import { GPU_MEMORY_PROFILES, DEFAULT_GPU_PROFILE_KEY, getGpuProfile } from '../data/gpuTuningProfiles.js';

/**
 * 뷰어 HUD 및 사용자 인터랙션 오버레이 관리자
 */
export class OverlayUI {
  /**
   * @param {Object} [options]
   * @param {Object} [options.presets] - 모델 프리셋 사전 객체 (미지정 시 PRESET_MODELS 사용)
   * @param {string} [options.initialPresetKey] - 초기 선택 프리셋 키
   * @param {string} [options.initialGpuProfileKey] - 초기 GPU 메모리 튜닝 프로필 키
   * @param {Function} [options.onModelSelect] - 프리셋 선택 콜백 (presetKey)
   * @param {Function} [options.onFileLoad] - 로컬 파일 로드 콜백 (File)
   * @param {Function} [options.onResetView] - 시점 리셋 콜백
   * @param {Function} [options.onGpuProfileChange] - GPU 메모리 프로필 변경 콜백 (profileKey)
   * @param {Function} [options.onSplatScaleChange] - 스플랫 크기 변경 콜백
   * @param {Function} [options.onAlphaCutoffChange] - 알파 컷오프 변경 콜백
   * @param {Function} [options.onPointCloudToggle] - 포인트 클라우드 모드 토글
   */
  constructor(options = {}) {
    this.presets = options.presets || PRESET_MODELS;
    this.initialPresetKey = options.initialPresetKey || DEFAULT_MODEL_KEY;
    this.initialGpuProfileKey = options.initialGpuProfileKey || DEFAULT_GPU_PROFILE_KEY;
    this.onModelSelect = options.onModelSelect || (() => {});
    this.onFileLoad = options.onFileLoad || (() => {});
    this.onResetView = options.onResetView || (() => {});
    this.onGpuProfileChange = options.onGpuProfileChange || (() => {});
    this.onSplatScaleChange = options.onSplatScaleChange || (() => {});
    this.onAlphaCutoffChange = options.onAlphaCutoffChange || (() => {});
    this.onPointCloudToggle = options.onPointCloudToggle || (() => {});

    this.modelSelect = /** @type {HTMLSelectElement | null} */ (document.getElementById('model-select'));
    this.fileInput = /** @type {HTMLInputElement | null} */ (document.getElementById('file-input'));
    this.btnResetCam = document.getElementById('btn-reset-cam');
    this.dropOverlay = document.getElementById('drop-zone-overlay');
    this.splatCountDisplay = document.getElementById('splat-count-display');
    this.formatDisplay = document.getElementById('format-display');
    this.vrActiveBadge = document.getElementById('vr-active-badge');
    this.renderedCountDisplay = document.getElementById('rendered-count-display');
    this.camPosDisplay = document.getElementById('camera-pos-display');

    // 튜닝 드로어 요소
    this.btnSettingsToggle = document.getElementById('btn-settings-toggle');
    this.btnSettingsClose = document.getElementById('btn-settings-close');
    this.settingsPanel = document.getElementById('settings-panel');
    this.selectGpuProfile = /** @type {HTMLSelectElement | null} */ (document.getElementById('select-gpu-profile'));
    this.badgeGpuProfile = document.getElementById('badge-gpu-profile');
    this.descGpuProfile = document.getElementById('desc-gpu-profile');
    this.sliderSplatScale = /** @type {HTMLInputElement | null} */ (document.getElementById('slider-splat-scale'));
    this.labelSplatScale = document.getElementById('label-splat-scale');
    this.sliderAlphaCutoff = /** @type {HTMLInputElement | null} */ (document.getElementById('slider-alpha-cutoff'));
    this.labelAlphaCutoff = document.getElementById('label-alpha-cutoff');
    this.togglePointCloud = /** @type {HTMLInputElement | null} */ (document.getElementById('toggle-point-cloud'));

    this.initModelSelectOptions();
    this.initGpuProfileOptions();
    this.initEventListeners();
    this.initDragAndDrop();
    this.initSettingsPanel();
  }

  /**
   * modelPresets 데이터 기반으로 셀렉트 박스 옵션을 동적 자동 렌더링
   */
  initModelSelectOptions() {
    if (!this.modelSelect || !this.presets) return;

    this.modelSelect.innerHTML = '';

    for (const [key, preset] of Object.entries(this.presets)) {
      const option = document.createElement('option');
      option.value = key;
      option.textContent = preset.name || key;
      this.modelSelect.appendChild(option);
    }

    const customOption = document.createElement('option');
    customOption.value = 'custom';
    customOption.textContent = '사용자 로컬 파일 (.ply / .splat)';
    this.modelSelect.appendChild(customOption);

    if (this.initialPresetKey && this.presets[this.initialPresetKey]) {
      this.modelSelect.value = this.initialPresetKey;
    }
  }

  /**
   * GPU 메모리 프로필 셀렉트 박스 옵션 렌더링 및 초기 상태 바인딩
   */
  initGpuProfileOptions() {
    if (!this.selectGpuProfile) return;

    this.selectGpuProfile.innerHTML = '';

    for (const [key, profile] of Object.entries(GPU_MEMORY_PROFILES)) {
      const option = document.createElement('option');
      option.value = key;
      option.textContent = profile.name;
      this.selectGpuProfile.appendChild(option);
    }

    if (this.initialGpuProfileKey && GPU_MEMORY_PROFILES[this.initialGpuProfileKey]) {
      this.selectGpuProfile.value = this.initialGpuProfileKey;
      this.updateGpuProfileUI(this.initialGpuProfileKey);
    }
  }

  /**
   * GPU 메모리 프로필 변경에 따른 UI 배지, 설명 및 컷오프 슬라이더 갱신
   * @param {string} profileKey
   */
  updateGpuProfileUI(profileKey) {
    const profile = getGpuProfile(profileKey);
    if (!profile) return;

    if (this.selectGpuProfile && this.selectGpuProfile.value !== profile.key) {
      this.selectGpuProfile.value = profile.key;
    }
    if (this.badgeGpuProfile) {
      this.badgeGpuProfile.textContent = profile.badgeText;
    }
    if (this.descGpuProfile) {
      this.descGpuProfile.textContent = profile.description;
    }
    if (this.sliderAlphaCutoff) {
      this.sliderAlphaCutoff.value = String(profile.sceneOptions.splatAlphaRemovalThreshold);
    }
    if (this.labelAlphaCutoff) {
      this.labelAlphaCutoff.textContent = `${profile.sceneOptions.splatAlphaRemovalThreshold}`;
    }
  }

  initEventListeners() {
    if (this.modelSelect) {
      this.modelSelect.addEventListener('change', (e) => {
        const target = /** @type {HTMLSelectElement} */ (e.target);
        const val = target.value;
        if (val !== 'custom') {
          this.onModelSelect(val);
        }
      });
    }

    if (this.fileInput) {
      this.fileInput.addEventListener('change', (e) => {
        const target = /** @type {HTMLInputElement} */ (e.target);
        const file = target.files?.[0];
        if (file) {
          this.validateAndLoadFile(file);
          // 동일 파일 재선택 가능하도록 input value 초기화
          target.value = '';
        }
      });
    }

    if (this.btnResetCam) {
      this.btnResetCam.addEventListener('click', () => {
        this.onResetView();
      });
    }
  }

  initSettingsPanel() {
    if (this.btnSettingsToggle && this.settingsPanel) {
      this.btnSettingsToggle.addEventListener('click', () => {
        this.settingsPanel.classList.toggle('hidden');
      });
    }

    if (this.btnSettingsClose && this.settingsPanel) {
      this.btnSettingsClose.addEventListener('click', () => {
        this.settingsPanel.classList.add('hidden');
      });
    }

    if (this.selectGpuProfile) {
      this.selectGpuProfile.addEventListener('change', (e) => {
        const target = /** @type {HTMLSelectElement} */ (e.target);
        const val = target.value;
        this.updateGpuProfileUI(val);
        this.onGpuProfileChange(val);
      });
    }

    if (this.sliderSplatScale) {
      this.sliderSplatScale.addEventListener('input', (e) => {
        const target = /** @type {HTMLInputElement} */ (e.target);
        const val = parseFloat(target.value);
        if (this.labelSplatScale) this.labelSplatScale.textContent = `${val.toFixed(2)}x`;
        this.onSplatScaleChange(val);
      });
    }

    if (this.sliderAlphaCutoff) {
      this.sliderAlphaCutoff.addEventListener('change', (e) => {
        const target = /** @type {HTMLInputElement} */ (e.target);
        const val = parseInt(target.value, 10);
        if (this.labelAlphaCutoff) this.labelAlphaCutoff.textContent = `${val}`;
        this.onAlphaCutoffChange(val);
      });
    }

    if (this.togglePointCloud) {
      this.togglePointCloud.addEventListener('change', (e) => {
        const target = /** @type {HTMLInputElement} */ (e.target);
        const checked = target.checked;
        this.onPointCloudToggle(checked);
      });
    }
  }

  initDragAndDrop() {
    let dragCounter = 0;

    window.addEventListener('dragenter', (e) => {
      e.preventDefault();
      dragCounter++;
      if (this.dropOverlay) {
        this.dropOverlay.classList.remove('hidden');
      }
    });

    window.addEventListener('dragleave', (e) => {
      e.preventDefault();
      dragCounter--;
      if (dragCounter <= 0) {
        dragCounter = 0;
        if (this.dropOverlay) {
          this.dropOverlay.classList.add('hidden');
        }
      }
    });

    window.addEventListener('dragover', (e) => {
      e.preventDefault();
    });

    window.addEventListener('drop', (e) => {
      e.preventDefault();
      dragCounter = 0;
      if (this.dropOverlay) {
        this.dropOverlay.classList.add('hidden');
      }

      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        this.validateAndLoadFile(files[0]);
      }
    });
  }

  /**
   * 사용자 로컬 파일 유효성 검사 및 안전한 로드 (100MB 크기 가드 포함)
   */
  validateAndLoadFile(file) {
    if (!file) return;

    // 1. 파일 확장자 검증
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['ply', 'splat', 'ksplat'].includes(ext)) {
      alert('지원되지 않는 파일 형식입니다. .splat, .ksplat, .ply 파일만 가능합니다.');
      return;
    }

    // 2. 100MB 사전 차단 가드 (브라우저 메모리 OOM 크래시 방지)
    const MAX_SIZE_BYTES = 100 * 1024 * 1024; // 100MB
    if (file.size > MAX_SIZE_BYTES) {
      const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
      alert(`[파일 크기 초과] 파일 용량이 너무 큽니다 (${sizeMB}MB).\n브라우저 메모리 보호 및 안정적인 렌더링을 위해 100MB 이하의 압축 파일(.ksplat 권장)만 로드할 수 있습니다.`);
      return;
    }

    if (this.modelSelect) this.modelSelect.value = 'custom';
    this.onFileLoad(file);
  }

  /**
   * 하단 씬 메타데이터 정보 갱신
   */
  updateSceneInfo({ splatCount, format }) {
    if (this.splatCountDisplay) {
      this.splatCountDisplay.textContent = Number(splatCount).toLocaleString();
    }
    if (this.formatDisplay) {
      this.formatDisplay.textContent = format || 'N/A';
    }
  }

  /**
   * WebXR 활성화 상태 배지 토글
   */
  setVRActive(isActive) {
    if (this.vrActiveBadge) {
      if (isActive) {
        this.vrActiveBadge.classList.remove('hidden');
      } else {
        this.vrActiveBadge.classList.add('hidden');
      }
    }
  }

  /**
   * 실시간 렌더링 프레임 통계 갱신 (렌더 스플랫 수 및 카메라 위치)
   * @param {Object} [stats]
   * @param {number} [stats.splatRenderCount]
   * @param {import('three').Vector3} [stats.cameraPosition]
   */
  updateRenderFrameStats({ splatRenderCount, cameraPosition } = {}) {
    if (this.renderedCountDisplay && splatRenderCount !== undefined) {
      this.renderedCountDisplay.textContent = splatRenderCount.toLocaleString();
    }
    if (this.camPosDisplay && cameraPosition) {
      this.camPosDisplay.textContent = `${cameraPosition.x.toFixed(1)}, ${cameraPosition.y.toFixed(1)}, ${cameraPosition.z.toFixed(1)}`;
    }
  }
}
