// Fish's published S2 model card lists these language codes. Coverage is a
// provider claim, NOT NoteFish end-to-end phone verification.
// https://huggingface.co/fishaudio/s2-pro#supported-languages (2026-09-12)
// The S2.1 hosted model advertises 83 languages; retain this explicit catalog
// rather than inventing unlisted languages to reach a marketing count.
const catalog = [
  ['af', 'Afrikaans'], ['sq', 'Albanian'], ['am', 'Amharic'], ['ar', 'Arabic'],
  ['hy', 'Armenian'], ['as', 'Assamese'], ['az', 'Azerbaijani'], ['eu', 'Basque'],
  ['be', 'Belarusian'], ['bn', 'Bengali'], ['bs', 'Bosnian'], ['br', 'Breton'],
  ['bg', 'Bulgarian'], ['my', 'Burmese'], ['ca', 'Catalan'], ['zh', 'Chinese'],
  ['hr', 'Croatian'], ['cs', 'Czech'], ['da', 'Danish'], ['nl', 'Dutch'],
  ['en', 'English'], ['et', 'Estonian'], ['fo', 'Faroese'], ['fi', 'Finnish'],
  ['fr', 'French'], ['gl', 'Galician'], ['ka', 'Georgian'], ['de', 'German'],
  ['el', 'Greek'], ['gu', 'Gujarati'], ['ht', 'Haitian Creole'], ['he', 'Hebrew'],
  ['hi', 'Hindi'], ['hu', 'Hungarian'], ['is', 'Icelandic'], ['id', 'Indonesian'],
  ['it', 'Italian'], ['ja', 'Japanese'], ['jv', 'Javanese'], ['kn', 'Kannada'],
  ['kk', 'Kazakh'], ['km', 'Khmer'], ['ko', 'Korean'], ['la', 'Latin'],
  ['lv', 'Latvian'], ['lt', 'Lithuanian'], ['ml', 'Malayalam'], ['ms', 'Malay'],
  ['mr', 'Marathi'], ['mi', 'Māori'], ['mn', 'Mongolian'], ['ne', 'Nepali'],
  ['no', 'Norwegian'], ['nn', 'Norwegian Nynorsk'], ['ps', 'Pashto'], ['fa', 'Persian'],
  ['pl', 'Polish'], ['pt', 'Portuguese'], ['pa', 'Punjabi'], ['ro', 'Romanian'],
  ['ru', 'Russian'], ['sa', 'Sanskrit'], ['sr', 'Serbian'], ['sn', 'Shona'],
  ['sd', 'Sindhi'], ['si', 'Sinhala'], ['sk', 'Slovak'], ['xsl', 'South Slavey'],
  ['es', 'Spanish'], ['sw', 'Swahili'], ['sv', 'Swedish'], ['tl', 'Tagalog'],
  ['ta', 'Tamil'], ['te', 'Telugu'], ['th', 'Thai'], ['bo', 'Tibetan'],
  ['tr', 'Turkish'], ['uk', 'Ukrainian'], ['ur', 'Urdu'], ['vi', 'Vietnamese'],
  ['cy', 'Welsh'], ['yi', 'Yiddish'], ['yo', 'Yoruba'],
];

// jw is the deprecated language tag used by the model card; jv is canonical.
export const languages = catalog.map(([code, name]) => ({ code, name }));
export const languageCodes = new Set(languages.map(({ code }) => code));
export const languageName = code => languages.find(language => language.code === code)?.name || code;

/** The caller's language may be left to detection; the agent's may not. */
export const isCallerLanguage = code => code === 'auto' || languageCodes.has(code);
