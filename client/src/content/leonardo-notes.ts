// Leonardo notes shown in the interface (never in lessons). Edit freely:
// each note needs its text, a source, and where it fits best. Keep every
// claim checkable; when scholars disagree, say so in the text.

export type NotePlace = "home" | "words" | "saving" | "summary" | "diary" | "any";

export type LeonardoNote = {
  id: string;
  text: string;
  source: string;
  places: NotePlace[];
};

export const LEONARDO_NOTES: LeonardoNote[] = [
  {
    id: "word-lists",
    text: "In his mid-thirties Leonardo filled pages with lists of words to teach himself. He called himself “omo sanza lettere”, a man without letters.",
    source: "Codex Trivulzianus, Milan · Codex Atlanticus",
    places: ["words", "home"]
  },
  {
    id: "mirror",
    text: "Leonardo was left-handed and wrote his private notes right to left, in mirror script. Hold a mirror to the page and it reads normally. Your review words are written the same way, so Lucia can ask before you read them.",
    source: "Throughout the notebooks",
    places: ["home"]
  },
  {
    id: "hatching",
    text: "You can spot his left hand in the drawings: his shading lines slope from top left to bottom right, the opposite of most right-handed artists. Here, denser hatching means a word is more yours.",
    source: "Windsor and Uffizi drawings",
    places: ["words"]
  },
  {
    id: "folio",
    text: "Scholars number codex pages by folio: r (recto) is the front of a leaf, v (verso) the back. Each lesson is one leaf: today on the front, what you learned on the back.",
    source: "Codicology convention",
    places: ["home", "diary"]
  },
  {
    id: "pacioli",
    text: "Leonardo drew skeletal geometric solids, like the one turning here, for his friend Luca Pacioli's De divina proportione, printed in Venice in 1509. They were the only drawings of his printed in his lifetime.",
    source: "Pacioli, De divina proportione (1509)",
    places: ["saving"]
  },
  {
    id: "woodpecker",
    text: "Leonardo kept to-do lists too. One line reads: “Describe the tongue of the woodpecker.”",
    source: "Windsor notebooks",
    places: ["summary"]
  },
  {
    id: "portinari",
    text: "Another of his to-dos: ask Benedetto Portinari how people walk on ice in Flanders. He learned by asking people who knew.",
    source: "Codex Atlanticus",
    places: ["summary", "saving"]
  },
  {
    id: "venice",
    text: "Leonardo passed through Venice in 1500, the year before the Aldine press printed its first book in italic type, the type this notebook's English is set in.",
    source: "Leonardo's travels, 1499–1500 · Aldine Virgil, 1501",
    places: ["home", "saving"]
  },
  {
    id: "pages",
    text: "More than 7,000 pages of his notebooks survive, and scholars think that is only a fraction of what he wrote. Your codex starts at page one.",
    source: "Scholarly estimates vary",
    places: ["diary"]
  },
  {
    id: "library",
    text: "Around 1504 he listed 116 books he owned: a large library for a man who said he had no letters.",
    source: "Codex Madrid II",
    places: ["diary", "saving"]
  }
];

const STORAGE_KEY = "parola-viva.leonardo-note-turn";

// One note per screen, rotating through the list: prefers notes made for this
// place, and advances each time a screen asks, so notes don't repeat back to back.
export function pickLeonardoNote(place: NotePlace): LeonardoNote {
  let turn = 0;
  try {
    turn = Number(window.localStorage.getItem(STORAGE_KEY) ?? 0) || 0;
    window.localStorage.setItem(STORAGE_KEY, String(turn + 1));
  } catch {
    // Storage unavailable: fall back to the first matching note.
  }
  const matching = LEONARDO_NOTES.filter(
    (note) => note.places.includes(place) || note.places.includes("any")
  );
  const pool = matching.length ? matching : LEONARDO_NOTES;
  return pool[turn % pool.length];
}
