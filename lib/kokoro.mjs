// Kokoro-82M's voices, from its VOICES.md (huggingface.co/hexgrad/Kokoro-82M). A voice's first letter is its
// language, and that letter is the lang_code Kokoro reads the text with: af_heart is American English, bf_emma
// British, ff_siwis French. `grade` is Kokoro's own estimate of how good the voice is (null where it gives none).
// Every language but English is thin in Kokoro: few voices, mostly graded C or D.
export const kokoroLanguages = {
  a: {name: 'American English', whisper: 'en'},
  b: {name: 'British English', whisper: 'en'},
  e: {name: 'Spanish', whisper: 'es', needs: 'espeak-ng'},
  f: {name: 'French', whisper: 'fr', needs: 'espeak-ng'},
  h: {name: 'Hindi', whisper: 'hi', needs: 'espeak-ng'},
  i: {name: 'Italian', whisper: 'it', needs: 'espeak-ng'},
  p: {name: 'Brazilian Portuguese', whisper: 'pt', needs: 'espeak-ng'},
  j: {name: 'Japanese', whisper: 'ja', needs: 'misaki[ja]'},
  z: {name: 'Mandarin Chinese', whisper: 'zh', needs: 'misaki[zh]'},
};

const grades = {
  af_heart: 'A', af_alloy: 'C', af_aoede: 'C+', af_bella: 'A-', af_jessica: 'D', af_kore: 'C+', af_nicole: 'B-', af_nova: 'C', af_river: 'D',
  af_sarah: 'C+', af_sky: 'C-', am_adam: 'F+', am_echo: 'D', am_eric: 'D', am_fenrir: 'C+', am_liam: 'D', am_michael: 'C+', am_onyx: 'D',
  am_puck: 'C+', am_santa: 'D-',
  bf_alice: 'D', bf_emma: 'B-', bf_isabella: 'C', bf_lily: 'D', bm_daniel: 'D', bm_fable: 'C', bm_george: 'C', bm_lewis: 'D+',
  jf_alpha: 'C+', jf_gongitsune: 'C', jf_nezumi: 'C-', jf_tebukuro: 'C', jm_kumo: 'C-',
  zf_xiaobei: 'D', zf_xiaoni: 'D', zf_xiaoxiao: 'D', zf_xiaoyi: 'D', zm_yunjian: 'D', zm_yunxi: 'D', zm_yunxia: 'D', zm_yunyang: 'D',
  ef_dora: null, em_alex: null, em_santa: null,
  ff_siwis: 'B-',
  hf_alpha: 'C', hf_beta: 'C', hm_omega: 'C', hm_psi: 'C',
  if_sara: 'C', im_nicola: 'C',
  pf_dora: null, pm_alex: null, pm_santa: null,
};

// [{name, code, language, gender, grade}], in VOICES.md's order.
export const kokoroVoices = Object.entries(grades).map(([name, grade]) =>
  ({name, code: name[0], language: kokoroLanguages[name[0]].name, gender: name[1] === 'f' ? 'female' : 'male', grade}));

export const isKokoroVoice = name => Object.hasOwn(grades, name);
// The language a voice speaks (its lang_code), or null for a name Kokoro doesn't have.
export const voiceLanguage = name => isKokoroVoice(name) ? name[0] : null;
