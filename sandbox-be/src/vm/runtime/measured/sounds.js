// 実測データ: 音の定義（world.soundDefinitionRegistry）。
//
// 2.10 で入った SoundDefinition / SoundDurationInfo は、リソース側の音の一覧が出どころなので、
// 専用サーバーで何が返るのかを実機に聞くまで中身を決められない。
// calibrate --measure で取れていればそれを返し、取れていなければ今までどおり空の一覧のまま
// （形だけ作って数字を上げない）。getPlaybackPosition は再生中に動く値なので、測った 1 点では返さない。

const MEASURED_SOUNDS = M.sounds?.list ?? [];
if (MEASURED_SOUNDS.length) {
  const soundDefs = MEASURED_SOUNDS.map((sd) => ({
    soundEventId: sd.id,
    tags: sd.tags ?? undefined,
    duration: sd.duration ?? null,
    music: sd.music ?? null,
    valid: () => true,
  }));
  IMPL.SoundDefinitionRegistry.fns.getDefinitions = () => soundDefs.map((sd) => once('SoundDefinition', sd));
  IMPL.SoundDefinition = {
    get: {
      soundEventId: (h) => h.soundEventId,
      tags: (h) => (h.tags ? [...h.tags] : undefined),
      durationInfo: (h) => (h.duration ? once('SoundDurationInfo', (h._dur ??= { ...h.duration, valid: () => true })) : undefined),
      musicInfo: (h) => (h.music ? once('SoundDefinitionMusicInfo', (h._music ??= { data: h.music, valid: () => true })) : undefined),
    },
  };
  IMPL.SoundDurationInfo = {
    get: {
      duration: (h) => h.duration,
      isActive: (h) => h.isActive,
    },
    fns: {
      // 再生位置は鳴らしている間だけ動く。測った 1 点を返すと実機と違うので、まだ再現しない
      getPlaybackPosition: ni('soundDurationInfo.getPlaybackPosition（再生中に動く値です。実機で測っていません）'),
    },
  };
}
