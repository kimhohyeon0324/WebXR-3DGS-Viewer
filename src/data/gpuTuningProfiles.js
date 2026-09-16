/**
 * 3DGS 대용량 씬 대비 GPU 메모리 및 렌더링 튜닝 프로필 정의
 */

export const GPU_MEMORY_PROFILES = Object.freeze({
  HIGH_QUALITY: {
    key: 'HIGH_QUALITY',
    name: '고품질 (High Quality)',
    description: '고사양 PC 전용 (FP32 원본 정밀도, 무압축)',
    badgeText: 'FP32 원본 정밀도 (Full VRAM)',
    viewerOptions: {
      halfPrecisionCovariancesOnGPU: false,
      inMemoryCompressionLevel: 0,
      freeIntermediateSplatData: false,
      integerBasedSort: true,
      sphericalHarmonicsDegree: 1
    },
    sceneOptions: {
      splatAlphaRemovalThreshold: 1
    }
  },
  BALANCED: {
    key: 'BALANCED',
    name: '균형 모드 (Balanced - 기본 권장)',
    description: 'FP16 반정밀도 (VRAM 50% 절감, 중간 버퍼 즉시 해제, 16-bit 압축)',
    badgeText: 'FP16 활성 (VRAM ~50% 절감)',
    viewerOptions: {
      halfPrecisionCovariancesOnGPU: true,
      inMemoryCompressionLevel: 1,
      freeIntermediateSplatData: true,
      integerBasedSort: true,
      sphericalHarmonicsDegree: 0
    },
    sceneOptions: {
      splatAlphaRemovalThreshold: 5
    }
  },
  MEMORY_SAVER: {
    key: 'MEMORY_SAVER',
    name: '대용량 / VR 절약 (Memory Saver)',
    description: '대용량 씬 및 Meta Quest 독립형 VR 특화 (최대 압축, 저투명 가우시안 적극 제거)',
    badgeText: '최대 압축 & 저투명 컬링 (Quest 권장)',
    viewerOptions: {
      halfPrecisionCovariancesOnGPU: true,
      inMemoryCompressionLevel: 2,
      freeIntermediateSplatData: true,
      integerBasedSort: false, // 대용량 씬 거리 오버플로우 방지
      sphericalHarmonicsDegree: 0
    },
    sceneOptions: {
      splatAlphaRemovalThreshold: 12
    }
  }
});

export const DEFAULT_GPU_PROFILE_KEY = 'BALANCED';

/**
 * 프로필 키로 프로필 객체 조회 (유효하지 않을 경우 DEFAULT_GPU_PROFILE_KEY 반환)
 * @param {string} key
 * @returns {Object}
 */
export function getGpuProfile(key) {
  if (key && GPU_MEMORY_PROFILES[key]) {
    return GPU_MEMORY_PROFILES[key];
  }
  return GPU_MEMORY_PROFILES[DEFAULT_GPU_PROFILE_KEY];
}
