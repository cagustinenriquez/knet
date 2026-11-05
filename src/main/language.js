// Which language a job posting is written in, for the "Job languages" setting.
//
// Counts common words that are distinctive for each language ("the", "with" vs "el", "con" …).
// Japanese is told apart by its script. Short texts (title-only feeds) return null: too little
// to go on, so they're never filtered out.

const LANGUAGES = {
  en: 'English', es: 'Spanish', pt: 'Portuguese', de: 'German', fr: 'French', it: 'Italian', nl: 'Dutch', ja: 'Japanese',
};

// Kept mostly apart: a word shared by two languages ("de", "la", "que") tells them apart poorly.
const WORDS = {
  en: 'the and with you your our will are for this have from that team experience work we be as or',
  es: 'el los las del y experiencia trabajo equipo nuestro nuestra años conocimientos buscamos desarrollo somos sobre también puesto empresa al estamos búsqueda buscando ingeniería sistemas tu nos laboral estudios',
  pt: 'os do da dos das com você nosso nossa experiência trabalho equipe vaga conhecimento não em ou são atuação',
  de: 'der die und mit für ist wir ein eine zu von auf den dem nicht auch bei oder erfahrung sie du deine unser',
  fr: 'les des et est pour avec vous nous dans sur du au être pas expérience équipe poste une votre',
  it: 'il di che per della nel siamo esperienza lavoro sono gli delle nostro anche alla ruolo',
  nl: 'het een van je voor wij ons onze zijn niet ervaring werk bij naar ook jouw wat',
};
const LOOKUP = new Map();
for (const [lang, list] of Object.entries(WORDS)) for (const w of list.split(' ')) LOOKUP.set(w, lang);

const MIN_HITS = 8;  // fewer known words than this → don't guess
const MARGIN = 1.5;  // the winner needs 1.5× the runner-up

function detectLanguage(text = '') {
  const sample = String(text).slice(0, 4000);
  const kana = (sample.match(/[぀-ヿ]/g) || []).length;
  if (kana >= 20) return 'ja';
  const counts = {};
  for (const word of sample.toLowerCase().match(/\p{L}+/gu) || []) {
    const lang = LOOKUP.get(word);
    if (lang) counts[lang] = (counts[lang] || 0) + 1;
  }
  const [first, second] = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!first || first[1] < MIN_HITS) return null;
  if (second && first[1] < second[1] * MARGIN) return null; // mixed text: don't guess
  return first[0];
}

module.exports = { LANGUAGES, detectLanguage };
