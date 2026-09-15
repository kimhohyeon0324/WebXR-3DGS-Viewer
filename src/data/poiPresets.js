/**
 * 3DGS 프리셋 모델별 공간 어노테이션(POI) 메타데이터 정의
 */
export const POI_PRESETS = {
  bonsai: [
    {
      id: 'poi-bonsai-audio',
      title: 'Bonsai 상단 벚꽃 잎 (공간 오디오)',
      type: 'audio',
      coordinates: { x: 0.274, y: 1.495, z: 0.114 },
      description: '가지와 잎사귀의 미세한 바람 소리를 재현하는 3D 공간 음향(Spatial Audio) 앵커 포인트입니다. Meta Quest 3D 오디오 렌더러와 동기화됩니다.'
    },
    {
      id: 'poi-bonsai-haptic',
      title: '화분 조약돌 (햅틱 진동 피드백)',
      type: 'haptic',
      coordinates: { x: 0.041, y: 1.185, z: 0.088 },
      description: '화분 표면 및 거친 나무 껍질의 질감을 표현하는 햅틱 진동 패턴(Haptic Feedback Pulse) 메타데이터가 바인딩된 지점입니다.'
    }
  ],
  dragon: [
    {
      id: 'poi-dragon-head',
      title: '골든 드래곤 붉은 뿔 (공간 오디오)',
      type: 'audio',
      coordinates: { x: -0.116, y: 1.665, z: 0.074 },
      description: '황금 용의 머리와 붉은 뿔 부위에서 울려 퍼지는 중후한 용의 숨결 3D 공간 오디오 포인트입니다.'
    },
    {
      id: 'poi-dragon-body',
      title: '황금 비늘 및 가슴 (햅틱 진동 피드백)',
      type: 'haptic',
      coordinates: { x: 0.385, y: 0.780, z: 0.445 },
      description: '용의 거친 황금 비늘 질감과 심장 박동을 모사하는 햅틱 진동 패턴 메타데이터 앵커입니다.'
    }
  ]
};
