import * as THREE from 'three';

/**
 * WebXR Controller Laser Guide & Visual Affordance Module
 * 
 * 레이저 가이드라인 색상/불투명도 전환, 3D POI 핀 호버 감지 및 시각 어포던스를 전담 관리하는 UI 뷰 모듈입니다.
 */
export class XRControllerVisualizer {
  static COLORS = {
    DEFAULT: 0x00f0ff, // 대기 상태 (시안)
    HOVER: 0xffaa00,   // POI 핀 조준 (골드)
    PITCH: 0xf97316,   // 왼손 트리거 X축 틸트 (앰버/오렌지)
    YAW: 0xa855f7,     // 오른손 트리거 Y축 자전 (보라)
    PAN: 0x10b981      // 그립 모델 위치 이동 (에메랄드 그린)
  };

  static OPACITY = {
    DEFAULT: 0.35,
    ACTIVE: 0.85,
    HOVER: 0.95
  };

  constructor() {
    this._hoveredPins = new Map();
    this._tempRayOrigin = new THREE.Vector3();
    this._tempRayDirection = new THREE.Vector3();
  }

  /**
   * 컨트롤러의 레이저 가이드라인 색상 및 투명도 갱신
   * @param {THREE.XRTargetRaySpace} controller
   * @param {number} hexColor
   * @param {number} opacity
   */
  setLaserStyle(controller, hexColor, opacity) {
    const laser = controller?.getObjectByName('laserGuide');
    if (laser && laser.material) {
      laser.material.color.setHex(hexColor);
      laser.material.opacity = opacity;
    }
  }

  /**
   * 매 프레임 컨트롤러별 인터랙션 상태에 따른 레이저 가이드라인 색상 갱신 및 POI 핀 호버 감지
   * @param {Array<THREE.XRTargetRaySpace>} controllers
   * @param {Object} inputState - XRInputReader.state
   * @param {Object} activeTransforms - { isLeftRotating, isRightRotating, isPanActive, isTwoHandGrabbing }
   * @param {Object} [poiManager] - POI 관리자
   * @param {Object} [inputReader] - XRInputReader 인스턴스 (호버 진입 시 햅틱 펄스 발송용)
   */
  update(controllers, inputState, activeTransforms, poiManager, inputReader) {
    if (!controllers || controllers.length === 0) return;

    const isTransforming = activeTransforms.isLeftRotating ||
                          activeTransforms.isRightRotating ||
                          activeTransforms.isPanActive ||
                          activeTransforms.isTwoHandGrabbing;

    for (let i = 0; i < controllers.length; i++) {
      const ctrl = controllers[i];
      if (!ctrl) continue;
      const handedness = ctrl.userData?.handedness || (i === 0 ? 'right' : 'left');

      const isTrigger = handedness === 'left' ? inputState.leftTrigger : inputState.rightTrigger;
      const isGrip = handedness === 'left' ? inputState.leftGrip : inputState.rightGrip;

      // 1. POI 레이저 호버 감지 (모델 조작 트랜스폼 중이 아닐 때만 유효)
      let hoveredPin = null;
      if (poiManager && !isTransforming) {
        ctrl.getWorldPosition(this._tempRayOrigin);
        ctrl.getWorldDirection(this._tempRayDirection);
        this._tempRayDirection.negate();
        hoveredPin = poiManager.checkRayHover(this._tempRayOrigin, this._tempRayDirection);
      }

      // 2. 상태별 레이저 컬러 피드백 적용
      if (isTrigger) {
        if (handedness === 'left') {
          // 왼손 트리거: X축 틸트 회전 중 (오렌지/앰버)
          this.setLaserStyle(ctrl, XRControllerVisualizer.COLORS.PITCH, XRControllerVisualizer.OPACITY.ACTIVE);
        } else {
          // 오른손 트리거: Y축 자전 회전 중 (보라색)
          this.setLaserStyle(ctrl, XRControllerVisualizer.COLORS.YAW, XRControllerVisualizer.OPACITY.ACTIVE);
        }
      } else if (isGrip) {
        // 그립 위치 이동 중 (에메랄드 그린)
        this.setLaserStyle(ctrl, XRControllerVisualizer.COLORS.PAN, XRControllerVisualizer.OPACITY.ACTIVE);
      } else {
        const prevHovered = this._hoveredPins.get(ctrl);
        if (hoveredPin) {
          if (!prevHovered && inputReader) {
            inputReader.triggerHaptic(ctrl, 0.25, 12);
          }
          this.setLaserStyle(ctrl, XRControllerVisualizer.COLORS.HOVER, XRControllerVisualizer.OPACITY.HOVER);
          this._hoveredPins.set(ctrl, hoveredPin);
        } else {
          this.setLaserStyle(ctrl, XRControllerVisualizer.COLORS.DEFAULT, XRControllerVisualizer.OPACITY.DEFAULT);
          this._hoveredPins.delete(ctrl);
        }
      }
    }
  }

  /**
   * 세션 종료 또는 리셋 시 시각 상태 초기화
   * @param {Array<THREE.XRTargetRaySpace>} controllers
   */
  reset(controllers) {
    this._hoveredPins.clear();
    if (!controllers) return;
    for (let i = 0; i < controllers.length; i++) {
      const ctrl = controllers[i];
      if (ctrl) {
        this.setLaserStyle(ctrl, XRControllerVisualizer.COLORS.DEFAULT, XRControllerVisualizer.OPACITY.DEFAULT);
      }
    }
  }
}
