/**
 * 프리셋 3DGS 모델 메타데이터 및 카메라/피벗 정합 파라미터 정의
 */
export const PRESET_MODELS = {
  bonsai: {
    name: 'Bonsai Tree (경량 .ksplat)',
    path: '/models/bonsai_trimmed.ksplat',
    // 테이블 상판 및 나무 받침대(11.17° 미세 잔여 경사)를 추가 교정하여 지면과 100% 수평 정합한 쿼터니언
    rotation: [0.917140, -0.187314, 0.018722, 0.351307],
    scale: [0.35, 0.35, 0.35],
    // 테이블 기둥 바닥 천 끝자락을 그리드 바닥(y=0.00)에 안착시키고 XZ 중심 정렬
    position: [0.032, 1.926, 0.055],
    cameraPosition: [0.0, 1.35, 2.1],
    cameraLookAt: [0.0, 1.15, 0.0],
    cameraUp: [0.0, 1.0, 0.0]
  },
  dragon: {
    name: 'Dragon (단일 .splat)',
    path: '/models/dragon.splat',
    // OpenCV 거꾸로 된 좌표계를 정상 Three.js Y-Up으로 기립시키는 X축 180도 회전
    rotation: [1, 0, 0, 0],
    // 스탠포드 드래곤 받침대를 지면 y=0.00에 완벽하게 안착시키는 position
    position: [0.0, 0.796, 0.0],
    scale: [1.3, 1.3, 1.3],
    cameraPosition: [0.0, 1.1, 2.3],
    cameraLookAt: [0.0, 0.85, 0.0],
    cameraUp: [0, 1, 0]
  }
};

export const DEFAULT_MODEL_KEY = 'bonsai';

/**
 * 등록된 프리셋 모델 목록을 원형 순환(Circular Indexing)하여 다음 모델 키 반환
 * N개의 모델이 추가되더라도 코드 수정 없이 유연하게 순환 전환 가능
 * @param {string} currentKey - 현재 선택된 프리셋 키
 * @returns {string} 다음 모델 프리셋 키
 */
export function getNextPresetKey(currentKey) {
  const keys = Object.keys(PRESET_MODELS);
  if (keys.length === 0) return null;
  const idx = keys.indexOf(currentKey);
  if (idx === -1) return keys[0];
  return keys[(idx + 1) % keys.length];
}
