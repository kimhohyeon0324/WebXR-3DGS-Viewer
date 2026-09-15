import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { ObjectTransformController } from '../src/core/xr/ObjectTransformController.js';

describe('ObjectTransformController - 3D 수학 및 물리 엔진 단위 테스트', () => {
  let controller;

  beforeEach(() => {
    controller = new ObjectTransformController({
      pivotOffset: new THREE.Vector3(0, 1.15, 0),
      minScale: 0.1,
      maxScale: 6.0
    });
  });

  describe('1. 초기 상태 및 피벗 오프셋(Pivot Offset)', () => {
    it('기본 트랜스폼 및 제약 조건이 올바르게 초기화되어야 한다', () => {
      expect(controller.modelPosition.toArray()).toEqual([0, 0, 0]);
      expect(controller.modelScale).toBe(1.0);
      expect(controller.minScale).toBe(0.1);
      expect(controller.maxScale).toBe(6.0);
      expect(controller.pivotOffset.y).toBeCloseTo(1.15);
    });

    it('인자 없이 생성 시 DEFAULT_TRANSFORM_CONFIG의 피벗(0, 1.15, 0)과 기본 감도가 적용되어야 한다', () => {
      const defaultCtrl = new ObjectTransformController();
      expect(defaultCtrl.pivotOffset.y).toBeCloseTo(1.15);
      expect(defaultCtrl.config.ROTATION_POS_SENSITIVITY).toBe(4.0);
      expect(defaultCtrl.config.PAN_SENSITIVITY).toBe(3.5);
    });

    it('사용자 정의 config 주입 시 기본 상수를 오버라이드해야 한다', () => {
      const customCtrl = new ObjectTransformController({
        config: { ROTATION_POS_SENSITIVITY: 8.0, PAN_SENSITIVITY: 5.0 }
      });
      expect(customCtrl.config.ROTATION_POS_SENSITIVITY).toBe(8.0);
      expect(customCtrl.config.PAN_SENSITIVITY).toBe(5.0);
      expect(customCtrl.config.ROTATION_WRIST_SENSITIVITY).toBe(1.8); // 미지정 속성은 기본값 유지
    });

    it('피벗 오프셋 갱신 시 값이 안전하게 복사되어야 한다', () => {
      controller.setPivotOffset(new THREE.Vector3(0.5, 2.0, -0.5));
      expect(controller.pivotOffset.x).toBe(0.5);
      expect(controller.pivotOffset.y).toBe(2.0);
      expect(controller.pivotOffset.z).toBe(-0.5);
    });
  });

  describe('2. 피벗 역보정 수식 검증 (Pivot Offset Compensation)', () => {
    // 수식: P_meshWorld = P_model - q_model * (O_pivot * S_model)
    it('회전이 없을 때 피벗 역보정으로 메쉬 월드 좌표가 정확히 계산되어야 한다', () => {
      const mockMesh = new THREE.Object3D();
      controller.setPivotOffset(new THREE.Vector3(0, 1.0, 0));
      controller.modelPosition.set(0, 2.0, 0);
      controller.modelScale = 1.5;
      controller.modelQuaternion.identity();

      controller.applyTransform(mockMesh);

      // meshWorldPos = (0, 2, 0) - (0, 1.0 * 1.5, 0) = (0, 0.5, 0)
      expect(mockMesh.position.x).toBeCloseTo(0);
      expect(mockMesh.position.y).toBeCloseTo(0.5);
      expect(mockMesh.position.z).toBeCloseTo(0);
      expect(mockMesh.scale.x).toBeCloseTo(1.5);
    });

    it('180도 Z축 회전 시 피벗 오프셋이 회전하여 메쉬 위치에 반영되어야 한다', () => {
      const mockMesh = new THREE.Object3D();
      controller.setPivotOffset(new THREE.Vector3(0, 1.0, 0));
      controller.modelPosition.set(0, 2.0, 0);
      controller.modelScale = 1.0;
      // Z축 180도 회전 -> (0, 1, 0) 피벗이 (0, -1, 0)으로 반전
      controller.modelQuaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI);

      controller.applyTransform(mockMesh);

      // meshWorldPos = (0, 2, 0) - (0, -1.0, 0) = (0, 3.0, 0)
      expect(mockMesh.position.x).toBeCloseTo(0);
      expect(mockMesh.position.y).toBeCloseTo(3.0);
      expect(mockMesh.position.z).toBeCloseTo(0);
    });
  });

  describe('3. 스케일 클램핑 (Scale Clamping)', () => {
    it('썸스틱 축소 시 minScale(0.1) 미만으로 줄어들지 않아야 한다', () => {
      // stickZoom > 0: 축소 입력
      for (let i = 0; i < 50; i++) {
        controller.handleThumbstickZoom(1.0, 0.05);
      }
      expect(controller.targetScale).toBeGreaterThanOrEqual(0.1);
      expect(controller.targetScale).toBeCloseTo(0.1);
    });

    it('썸스틱 확대 시 maxScale(6.0)을 초과하지 않아야 한다', () => {
      // stickZoom < 0: 확대 입력
      for (let i = 0; i < 50; i++) {
        controller.handleThumbstickZoom(-1.0, 0.05);
      }
      expect(controller.targetScale).toBeLessThanOrEqual(6.0);
      expect(controller.targetScale).toBeCloseTo(6.0);
    });
  });

  describe('4. 단일 축 분리 회전 (Single-Axis Rotation)', () => {
    it('오른손 트리거(Yaw) 조작 시 오직 월드 Y축으로만 자전해야 한다', () => {
      const camera = new THREE.PerspectiveCamera();
      camera.position.set(0, 1.6, 2.0);
      camera.lookAt(0, 1.6, 0);
      camera.updateMatrixWorld();

      const mockController = new THREE.Object3D();
      mockController.position.set(0.2, 1.2, -0.3);
      mockController.quaternion.identity();

      // 첫 틱: 조작 시작
      controller.handleRightTriggerRotate(mockController, camera);
      expect(controller.isRightRotating).toBe(true);

      // 둘째 틱: X축으로 수평 0.1m 이동
      mockController.position.x += 0.1;
      controller.handleRightTriggerRotate(mockController, camera);

      // 오일러 각도로 분해하여 Y축 회전만 발생했는지 검증
      const euler = new THREE.Euler().setFromQuaternion(controller.targetQuaternion, 'YXZ');
      expect(Math.abs(euler.y)).toBeGreaterThan(0.01);
      expect(euler.x).toBeCloseTo(0, 3); // Pitch 왜곡 없음
      expect(euler.z).toBeCloseTo(0, 3); // Roll 왜곡 없음
    });

    it('왼손 트리거(Pitch) 조작 시 카메라 수평축으로 상하 틸트 회전해야 한다', () => {
      const camera = new THREE.PerspectiveCamera();
      camera.position.set(0, 1.6, 2.0);
      camera.lookAt(0, 1.6, 0);
      camera.updateMatrixWorld();

      const mockController = new THREE.Object3D();
      mockController.position.set(-0.2, 1.2, -0.3);
      mockController.quaternion.identity();

      // 첫 틱: 조작 시작
      controller.handleLeftTriggerRotate(mockController, camera);
      expect(controller.isLeftRotating).toBe(true);

      // 둘째 틱: Y축으로 수직 0.1m 이동
      mockController.position.y += 0.1;
      controller.handleLeftTriggerRotate(mockController, camera);

      const euler = new THREE.Euler().setFromQuaternion(controller.targetQuaternion, 'YXZ');
      expect(Math.abs(euler.x)).toBeGreaterThan(0.01); // Pitch 회전 발생
      expect(euler.y).toBeCloseTo(0, 3); // Yaw 왜곡 없음
      expect(euler.z).toBeCloseTo(0, 3); // Roll 왜곡 없음
    });
  });

  describe('5. 지수 감쇠 물리 스무딩 (Exponential Damping EMA)', () => {
    it('프레임 갱신 시 목표 위치로 부드럽게 점근 수렴해야 한다', () => {
      controller.modelPosition.set(0, 0, 0);
      controller.targetPosition.set(1.0, 0, 0);

      // 10 프레임 시뮬레이션
      for (let i = 0; i < 10; i++) {
        controller.updateSmoothing(0.016);
      }

      // 목표 위치(1.0)에 점진적으로 다가가야 함
      expect(controller.modelPosition.x).toBeGreaterThan(0.5);
      expect(controller.modelPosition.x).toBeLessThan(1.0);
    });

    it('비정상적으로 큰 델타 타임(10초 등)이 유입되어도 발산하지 않아야 한다', () => {
      controller.modelPosition.set(0, 0, 0);
      controller.targetPosition.set(2.0, 0, 0);

      // 극단적인 프레임 지연(10초) 유입
      controller.updateSmoothing(10.0);

      expect(Number.isFinite(controller.modelPosition.x)).toBe(true);
      expect(controller.modelPosition.x).toBeLessThanOrEqual(2.0);
    });
  });

  describe('6. NaN / Infinity 방어 가드', () => {
    it('NaN 좌표가 유입되었을 때 메쉬 트랜스폼 오염을 완벽히 차단해야 한다', () => {
      const mockMesh = new THREE.Object3D();
      mockMesh.position.set(1, 1, 1);

      controller.modelPosition.set(NaN, 0, 0);
      controller.applyTransform(mockMesh);

      // 메쉬의 기존 유효 좌표가 유지되어야 함 (증발 방지)
      expect(mockMesh.position.x).toBe(1);
      expect(mockMesh.position.y).toBe(1);
      expect(mockMesh.position.z).toBe(1);
    });

    it('비정상 컨트롤러 센서 좌표(NaN) 유입 시 조작 계산을 건너뛰어야 한다', () => {
      const camera = new THREE.PerspectiveCamera();
      const mockController = new THREE.Object3D();
      mockController.position.set(NaN, 1.0, 0);

      controller.targetQuaternion.identity();
      controller.handleRightTriggerRotate(mockController, camera);

      expect(controller.isRightRotating).toBe(false);
      expect(controller.targetQuaternion.x).toBe(0);
      expect(controller.targetQuaternion.y).toBe(0);
      expect(controller.targetQuaternion.z).toBe(0);
      expect(controller.targetQuaternion.w).toBe(1);
    });
  });
});
