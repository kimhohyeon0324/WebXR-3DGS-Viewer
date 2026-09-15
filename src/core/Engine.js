import * as THREE from 'three';
import { SplatManager } from './SplatManager.js';
import { PerformanceStats } from './PerformanceStats.js';
import { WebXRManager } from './WebXRManager.js';
import { POIManager } from './POIManager.js';

/**
 * 3DGS WebXR Viewer의 메인 엔진 코어
 * Three.js 씬 그래프 및 SplatManager, WebXRManager, POIManager, 성능 모니터 결합
 */
export class Engine {
  /**
   * @param {Object} options
   * @param {HTMLElement} options.container - 뷰어 DOM
   * @param {HTMLElement} [options.vrButtonContainer] - VR 버튼 삽입 컨테이너
   * @param {Function} options.onProgress - 로딩 프로그레스
   * @param {Function} options.onSceneLoaded - 씬 로드 완료 이벤트
   * @param {Function} [options.onVRStateChanged] - VR 세션 진입/종료 상태 콜백 (isActive)
   * @param {Function} [options.onPOISelected] - 3D 핀 선택 콜백 (poiData)
   */
  constructor(options = {}) {
    this.container = options.container || document.getElementById('viewer-container');
    this.vrButtonContainer = options.vrButtonContainer || document.getElementById('vr-button-container');
    this.onProgress = options.onProgress || (() => {});
    this.onSceneLoaded = options.onSceneLoaded || (() => {});
    this.onVRStateChanged = options.onVRStateChanged || (() => {});
    this.onPOISelected = options.onPOISelected || (() => {});
    this.onModelToggle = options.onModelToggle || null;
    this.onFrameStats = options.onFrameStats || null;

    // Three.js 가상 공간 보조 씬 (그리드, 마커, 라이트 등)
    this.scene = new THREE.Scene();
    this.clock = new THREE.Clock();
    this.setupAuxiliaryScene();

    // 3DGS 스플랫 매니저 초기화
    this.splatManager = new SplatManager({
      container: this.container,
      threeScene: this.scene,
      onProgress: (pct, msg) => this.onProgress(pct, msg),
      onSceneLoaded: (data) => {
        this.onSceneLoaded(data);
        this.onFirstSceneReady();
      }
    });

    // 성능 모니터링 패널
    this.stats = new PerformanceStats();
    this.statsInitialized = false;

    // WebXR 관리자 및 POI 관리자
    this.webXRManager = null;
    this.poiManager = null;
    this.xrInitialized = false;

    this.initRenderStatsHook();
    this.initPointerPicker();
  }

  /**
   * 최초 씬 로드 완료 시 렌더러와 카메라를 기반으로 WebXR 및 POI 시스템 연동
   */
  onFirstSceneReady() {
    const renderer = this.splatManager.getRenderer();
    const camera = this.splatManager.getCamera();

    if (renderer && !this.statsInitialized) {
      this.stats.initRenderer(renderer);
      this.statsInitialized = true;
    }

    if (!this.poiManager && camera) {
      this.poiManager = new POIManager({
        scene: this.scene,
        camera: camera,
        renderer: renderer,
        onPOISelect: (data) => this.onPOISelected(data)
      });
    }

    if (renderer && camera && !this.xrInitialized) {
      this.initWebXR(renderer, camera);
      this.xrInitialized = true;
      const center = this.splatManager.getModelCenter();
      this.setPivotOffset(center);
    }
  }

  /**
   * WebXR 세션 매니저 초기화 및 인터랙션 루프 연결
   */
  initWebXR(renderer, camera) {
    this.webXRManager = new WebXRManager({
      renderer: renderer,
      camera: camera,
      scene: this.scene,
      buttonContainer: this.vrButtonContainer,
      poiManager: this.poiManager,
      splatManager: this.splatManager,
      onModelToggle: this.onModelToggle,
      onSessionStart: ({ session, cameraRig }) => {
        // VR 세션 진입 시 데스크톱 RAF 중단 (백그라운드 DOM 갱신 및 CPU 낭비 방지)
        this.stopDesktopRenderLoop();
        this.clock.start();
        this.splatManager.enterVR((time, frame) => {
          const delta = this.clock.getDelta();
          try {
            if (this.webXRManager) {
              this.webXRManager.update(delta);
            }
            if (this.poiManager) {
              this.poiManager.update(this.clock.getElapsedTime());
            }
          } catch (err) {
            console.error('[WebXR Frame Update Exception]:', err);
          }
        });
        this.onVRStateChanged(true);
      },
      onSessionEnd: () => {
        this.splatManager.exitVR();
        // VR 세션 종료 시 데스크톱 RAF 재개
        this.startDesktopRenderLoop();
        this.onVRStateChanged(false);
      }
    });
  }

  /**
   * 가상 씬 보조 요소 구성
   */
  setupAuxiliaryScene() {
    const grid = new THREE.GridHelper(10, 20, 0x00f0ff, 0x1e293b);
    grid.position.y = 0.0;
    grid.material.opacity = 0.35;
    grid.material.transparent = true;
    grid.material.depthWrite = false;
    this.scene.add(grid);

    const ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
    this.scene.add(ambientLight);
  }

  /**
   * PC 마우스 포인터 기반 POI 핀 피킹 리스너
   */
  initPointerPicker() {
    let downX = 0;
    let downY = 0;

    this._onPointerDown = (e) => {
      downX = e.clientX;
      downY = e.clientY;
    };

    this._onPointerUp = (e) => {
      // 드래그 회전이 아닌 단순 클릭 판정
      const dist = Math.hypot(e.clientX - downX, e.clientY - downY);
      if (dist < 5 && this.poiManager && !this.webXRManager?.isPresenting) {
        const camera = this.splatManager.getCamera();
        if (camera) {
          const normX = (e.clientX / window.innerWidth) * 2 - 1;
          const normY = -(e.clientY / window.innerHeight) * 2 + 1;
          this.poiManager.pickWithPointer(normX, normY, camera);
        }
      }
    };

    window.addEventListener('pointerdown', this._onPointerDown);
    window.addEventListener('pointerup', this._onPointerUp);
  }

  /**
   * 데스크톱 모드 렌더 루프 및 POI 애니메이션 틱
   */
  initRenderStatsHook() {
    this.startDesktopRenderLoop();
  }

  startDesktopRenderLoop() {
    if (this.statsFrameId !== null) return;

    const tick = () => {
      // VR 세션 활성화 중에는 데스크톱 RAF 중단
      if (this.webXRManager?.isPresenting) {
        this.statsFrameId = null;
        return;
      }

      if (this.stats) {
        this.stats.update();
      }
      if (this.poiManager) {
        this.poiManager.update(this.clock.getElapsedTime());
      }

      // 실시간 렌더 스플랫 수 및 카메라 위치 통계 콜백 발행 (DOM 직접 접근 제거)
      if (typeof this.onFrameStats === 'function' && this.splatManager?.viewer) {
        const viewer = this.splatManager.viewer;
        this.onFrameStats({
          splatRenderCount: viewer.splatRenderCount,
          cameraPosition: viewer.camera ? viewer.camera.position : null
        });
      }

      this.statsFrameId = requestAnimationFrame(tick);
    };
    this.statsFrameId = requestAnimationFrame(tick);
  }

  stopDesktopRenderLoop() {
    if (this.statsFrameId !== null) {
      cancelAnimationFrame(this.statsFrameId);
      this.statsFrameId = null;
    }
  }

  /**
   * 렌더링 퀄리티 튜닝 프록시
   */
  setSplatScale(scale) {
    this.splatManager.setSplatScale(scale);
  }

  setPointCloudMode(enabled) {
    this.splatManager.setPointCloudMode(enabled);
  }

  async setAlphaThreshold(threshold) {
    await this.splatManager.setAlphaThreshold(threshold);
  }

  /**
   * 모델 로드 프록시
   */
  async loadModel(source, options = {}) {
    return await this.splatManager.loadScene(source, options);
  }

  /**
   * 카메라 시점 리셋 프록시
   */
  resetView() {
    this.splatManager.resetCamera();
    if (this.webXRManager && this.webXRManager.getCameraRig()) {
      this.webXRManager.getCameraRig().position.set(0, 0, 0);
      this.webXRManager.getCameraRig().rotation.set(0, 0, 0);
    }
  }

  /**
   * 스플랫 카운트 조회
   */
  getSplatCount() {
    return this.splatManager.getSplatCount();
  }

  /**
   * POIManager 반환
   */
  getPOIManager() {
    return this.poiManager;
  }

  /**
   * WebXR 인터랙션 피벗(시각적 중심) 오프셋 설정
   */
  setPivotOffset(offset) {
    if (this.webXRManager) {
      let vec = offset;
      if (Array.isArray(offset)) {
        vec = new THREE.Vector3(offset[0], offset[1], offset[2]);
      }
      this.webXRManager.setPivotOffset(vec);
    }
  }

  /**
   * WebXR 모델 위치 및 시점 사용자 정면 재정합
   */
  recenterXR() {
    if (this.webXRManager?.interactionManager) {
      this.webXRManager.interactionManager.initViewPosition();
    }
  }

  /**
   * 프리셋 모델 및 연계 서브시스템(POI, 피벗, XR 시점) 통합 로드 (Facade 패턴)
   */
  async loadPreset(presetKey, presetData) {
    if (!presetData) return;

    await this.splatManager.loadScene(presetData.path, {
      position: presetData.position,
      rotation: presetData.rotation,
      scale: presetData.scale,
      cameraPosition: presetData.cameraPosition,
      cameraLookAt: presetData.cameraLookAt,
      cameraUp: presetData.cameraUp
    });

    if (this.poiManager) {
      this.poiManager.loadPreset(presetKey);
    }

    const pivot = presetData.cameraLookAt || this.splatManager.getModelCenter();
    this.setPivotOffset(pivot);
    this.recenterXR();
  }

  /**
   * 사용자 로컬 파일 및 연계 서브시스템 통합 로드
   */
  async loadCustomFile(file) {
    if (!file) return;

    await this.splatManager.loadScene(file);

    if (this.poiManager) {
      this.poiManager.clearPins();
    }

    const center = this.splatManager.getModelCenter();
    this.setPivotOffset(center);
    this.recenterXR();
  }

  /**
   * 엔진 수명 주기 종료 및 전체 리소스 해제
   */
  dispose() {
    this.stopDesktopRenderLoop();

    if (this._onPointerDown) {
      window.removeEventListener('pointerdown', this._onPointerDown);
      this._onPointerDown = null;
    }
    if (this._onPointerUp) {
      window.removeEventListener('pointerup', this._onPointerUp);
      this._onPointerUp = null;
    }

    if (this.poiManager) {
      this.poiManager.dispose();
      this.poiManager = null;
    }

    if (this.stats) {
      this.stats.dispose();
    }

    if (this.splatManager) {
      this.splatManager.dispose();
    }
  }
}
