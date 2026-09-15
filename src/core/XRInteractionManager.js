import * as THREE from 'three';
import { XRInputReader } from './xr/XRInputReader.js';
import { XRControllerVisualizer } from './xr/XRControllerVisualizer.js';
import { ObjectTransformController } from './xr/ObjectTransformController.js';

/**
 * WebXR 6DoF 직관적·물리적 뷰어 인터랙션 오케스트레이터 (XRInteractionManager)
 * 
 * 단일 책임 원칙(SRP)에 따라 세부 구현을 3대 전담 모듈로 위임하고,
 * 각 모듈 간의 유기적 상호작용 및 생명주기를 총괄 조율하는 경량 오케스트레이터입니다.
 * 
 * - XRInputReader: Gamepad API 및 WebXR 입력 이벤트 무할당 수신, 햅틱 펄스 발송
 * - XRControllerVisualizer: 레이저 색상/불투명도 전환, POI 호버 피드백 및 시각 어포던스
 * - ObjectTransformController: 피벗 역보정, 축 분리 회전, 3D 핀치 줌, 물리 지수 감쇠 스무딩
 */
export class XRInteractionManager {
  /**
   * @param {Object} options
   * @param {THREE.WebGLRenderer} options.renderer
   * @param {THREE.PerspectiveCamera} options.camera
   * @param {THREE.Group} options.cameraRig
   * @param {THREE.Scene} options.scene
   * @param {Array<THREE.XRTargetRaySpace>} options.controllers
   * @param {THREE.Object3D} [options.targetScene]
   * @param {Object} [options.poiManager]
   * @param {Object} [options.splatManager]
   * @param {Function} [options.onModelToggle]
   * @param {THREE.Vector3} [options.pivotOffset]
   */
  constructor(options = {}) {
    this.renderer = options.renderer;
    this.camera = options.camera;
    this.cameraRig = options.cameraRig;
    this.scene = options.scene;
    this.controllers = options.controllers || [];
    this.targetScene = options.targetScene || options.scene;
    this.poiManager = options.poiManager || null;
    this.splatManager = options.splatManager || null;
    this.onModelToggle = options.onModelToggle || null;

    this.active = false;

    // 1. 3D 수학 & 물리 트랜스폼 엔진 초기화
    this.transformController = new ObjectTransformController({
      pivotOffset: options.pivotOffset
    });

    // 2. 컨트롤러 비주얼라이저 초기화
    this.visualizer = new XRControllerVisualizer();

    // 3. 햅틱 발송 헬퍼 콜백
    this._hapticCallback = (controller, intensity, duration) => {
      this.inputReader?.triggerHaptic(controller, intensity, duration);
    };

    // 4. 레이저 피킹용 임시 벡터 (GC 차단)
    this._tempRayOrigin = new THREE.Vector3();
    this._tempRayDirection = new THREE.Vector3();

    // 5. 하드웨어 입력 수신 모듈 초기화
    this.inputReader = new XRInputReader({
      controllers: this.controllers,
      onSelectStart: (controller) => this._handleSelectStart(controller)
    });

    // 버튼 디바운싱 플래그
    this._wasRecenterPressed = false;
    this._wasPresetPressed = false;
  }

  // --- 기존 코드 호환용 Getter ---
  get modelPosition() { return this.transformController.modelPosition; }
  get modelQuaternion() { return this.transformController.modelQuaternion; }
  get modelScale() { return this.transformController.modelScale; }
  get targetPosition() { return this.transformController.targetPosition; }
  get targetQuaternion() { return this.transformController.targetQuaternion; }
  get targetScale() { return this.transformController.targetScale; }
  get pivotOffset() { return this.transformController.pivotOffset; }

  setPivotOffset(offset) {
    this.transformController.setPivotOffset(offset);
    this.applyTransform();
  }

  setPOIManager(poiManager) {
    this.poiManager = poiManager;
  }

  setSplatManager(splatManager) {
    this.splatManager = splatManager;
  }

  triggerHaptic(controller, intensity = 0.5, durationMs = 25) {
    this.inputReader.triggerHaptic(controller, intensity, durationMs);
  }

  setLaserStyle(controller, hexColor, opacity) {
    this.visualizer.setLaserStyle(controller, hexColor, opacity);
  }

  getActiveCamera() {
    if (this.renderer?.xr?.isPresenting) {
      return this.renderer.xr.getCamera();
    }
    return this.camera;
  }

  /**
   * 트리거 클릭 시 POI 피킹 우선 처리
   */
  _handleSelectStart(controller) {
    if (!this.active) return false;

    if (this.poiManager) {
      controller.getWorldPosition(this._tempRayOrigin);
      controller.getWorldDirection(this._tempRayDirection);
      this._tempRayDirection.negate();
      const pickedPOI = this.poiManager.pickWithRay(this._tempRayOrigin, this._tempRayDirection);
      if (pickedPOI) {
        controller.userData.isPickingPOI = true;
        this.inputReader.triggerHaptic(controller, 0.75, 35);
        return true;
      }
    }
    return false;
  }

  /**
   * 컨트롤러 WebXR 이벤트 바인딩
   */
  bindControllerEvents() {
    this.inputReader.bindControllerEvents();
  }

  /**
   * 컨트롤러 동적 연결/해제 갱신
   */
  updateInputSources(session) {
    this.inputReader.updateInputSources(session);
  }

  /**
   * VR 진입 시 모델 초기 배치
   */
  initViewPosition() {
    const cam = this.getActiveCamera();
    this.transformController.initViewPosition(cam);
    this.applyTransform();
  }

  /**
   * 시선 정면으로 모델 복귀 (Recenter)
   */
  recenterView(sourceController = null) {
    const cam = this.getActiveCamera();
    this.transformController.recenterView(cam);

    if (sourceController) {
      this.inputReader.triggerHaptic(sourceController, 0.6, 25);
      setTimeout(() => this.inputReader.triggerHaptic(sourceController, 0.7, 30), 100);
    }

    if (this.poiManager) {
      this.poiManager.showDefaultVRCard();
    }

    console.log('[XRInteractionManager] 뷰 복귀(Recenter) 실행');
  }

  /**
   * 현재 트랜스폼을 스플랫 및 POI에 실시간 반영
   */
  applyTransform() {
    const splatMesh = this.splatManager?.getSplatMesh();
    this.transformController.applyTransform(splatMesh, this.targetScene, this.poiManager);
  }

  activate() {
    this.active = true;
    this.transformController.resetTransformState();

    // 1차 초기 위치 동기화
    this.initViewPosition();

    // HMD 공간 트래킹 행렬 안정화 시점(250ms)에 정밀 재배치 및 POI 카드 표시
    setTimeout(() => {
      this.initViewPosition();
      if (this.poiManager) {
        this.poiManager.showDefaultVRCard();
      }
    }, 250);
  }

  deactivate() {
    this.active = false;
    this.transformController.resetTransformState();
    this.visualizer.reset(this.controllers);
  }

  /**
   * 매 WebXR 프레임 인터랙션 루프
   */
  update(delta = 0.016) {
    if (!this.active) return;

    const session = this.renderer?.xr?.getSession();
    const input = this.inputReader.poll(session);

    // 0. 리센터(Recenter) 버튼 처리 (A / X 버튼)
    if (input.recenterPressed) {
      if (!this._wasRecenterPressed) {
        this._wasRecenterPressed = true;
        this.recenterView(input.recenterSource);
      }
    } else {
      this._wasRecenterPressed = false;
    }

    // 0-1. 프리셋 모델 전환 처리 (B / Y 버튼)
    if (input.presetTogglePressed) {
      if (!this._wasPresetPressed) {
        this._wasPresetPressed = true;
        if (typeof this.onModelToggle === 'function' && !this.splatManager?.isLoading) {
          this.inputReader.triggerHaptic(input.presetToggleSource, 0.7, 30);
          this.onModelToggle();
        }
      }
    } else {
      this._wasPresetPressed = false;
    }

    // 0-2. 마우스 휠 대응: 썸스틱 상/하 확대/축소
    this.transformController.handleThumbstickZoom(input.stickZoom, delta);

    // 1. 그립(Grip) 조작: 양손 줌/회전 또는 단손 위치 이동 (Pan)
    if (input.leftGrip && input.rightGrip && input.leftController && input.rightController) {
      this.transformController.stopPanGrab(this._hapticCallback);
      this.transformController.handleTwoHandTransform(input.leftController, input.rightController, this._hapticCallback);
    } else {
      if (this.transformController.isTwoHandGrabbing) {
        this.transformController.stopTwoHandTransform();
      }

      if (input.rightGrip && input.rightController) {
        this.transformController.handlePanGrab(input.rightController, this._hapticCallback);
      } else if (input.leftGrip && input.leftController) {
        this.transformController.handlePanGrab(input.leftController, this._hapticCallback);
      } else {
        this.transformController.stopPanGrab(this._hapticCallback);
      }
    }

    // 2. 트리거(Trigger) 조작: 단일 축 분리 회전 (Pitch: 왼쪽, Yaw: 오른쪽)
    const cam = this.getActiveCamera();
    if (input.leftTrigger && input.leftController) {
      this.transformController.handleLeftTriggerRotate(input.leftController, cam, this._hapticCallback);
    } else {
      this.transformController.stopLeftTriggerRotate(input.leftController, this._hapticCallback);
    }

    if (input.rightTrigger && input.rightController) {
      this.transformController.handleRightTriggerRotate(input.rightController, cam, this._hapticCallback);
    } else {
      this.transformController.stopRightTriggerRotate(input.rightController, this._hapticCallback);
    }

    // 3. 레이저 시각 어포던스 및 POI 호버 피드백 갱신
    this.visualizer.update(
      this.controllers,
      input,
      {
        isLeftRotating: this.transformController.isLeftRotating,
        isRightRotating: this.transformController.isRightRotating,
        isPanActive: !!this.transformController.activePanController,
        isTwoHandGrabbing: this.transformController.isTwoHandGrabbing,
      },
      this.poiManager,
      this.inputReader
    );

    // 4. 물리적 지수 감쇠 스무딩 및 최종 트랜스폼 반영
    this.transformController.updateSmoothing(delta);
    this.applyTransform();
  }
}
