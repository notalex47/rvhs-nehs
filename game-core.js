const LETTER_WEIGHTS = [
  ["E", 12.7], ["T", 9.1], ["A", 8.2], ["O", 7.5], ["I", 7.0], ["N", 6.7],
  ["S", 6.3], ["H", 6.1], ["R", 6.0], ["D", 4.3], ["L", 4.0], ["C", 2.8],
  ["U", 2.8], ["M", 2.4], ["W", 2.4], ["F", 2.2], ["G", 2.0], ["Y", 2.0],
  ["P", 1.9], ["B", 1.5], ["V", 1.0], ["K", 0.75], ["J", 0.12], ["X", 0.12],
  ["Q", 0.10], ["Z", 0.07]
];

const VOWELS = new Set(["A", "E", "I", "O", "U", "Y"]);
const RARE = new Set(["J", "Q", "X", "Z"]);

// High-frequency, game-friendly words. This is NOT the acceptance dictionary. It is
// only used to rate random candidate boards, so generated boards are less likely to
// be dead grids. The full YAWL dictionary is loaded separately by app.js.
const COMMON_WORDS = `
ace ache act add age ago aid aim air ale all also am amber amen amid an and ant any ape arc are arm art ash ask ate aunt auto
away awe axis baby back bad bag bake ball band bank bar bare bark base bat bath be bead beam bean bear beat bed bee been beer bell
belt bend best bet bid big bike bill bind bird bit bite black blade blame blank blast blend block blood blow blue blur boat body boil
bold bone book boom boot bore born both bowl box boy brain brake branch brand brave bread break brick bridge bright bring broad broke
brown brush build burn burst bus bush busy buy by cab cage cake call calm came camp can cane cap care car card case cash cast cat catch
cause cave cell cent chair chance change charm chart chase cheap check cheer chest chief child chill chip choice choose city claim clap
class clean clear climb clock close cloud club coach coast code cold color come cook cool core corn cost could count court cover cow crack
craft crash cream cross crowd crown cry cup cut cute daily dance dark dash data date dawn day dead deal dear deck deep deer desk did die
dig dim dine dirt dish do dock dog done door dot down drag draw dream dress drink drive drop dry duck due dust each ear early earn earth
ease east easy eat edge eel egg eight else end enjoy enter era even ever every eye face fact fade fair fall fame fan far farm fast fate
fear feed feel feet fell felt few field fight file fill film final find fine fire firm first fish fit five flag flame flat flip float floor
flow fly foam fold food foot for force fork form found four fox free fresh friend frog from front frost full fun game gas gate gave gear
get ghost gift girl give glad glass glow go goal goat gold gone good got grab grade grain grand grass great green grew grid grin ground
grow guard guess guide hair half hall hand hang hard harm has hat hate have hay head hear heart heat heavy held help hen her here hero
hide high hill him hint hip hit hold hole home honey hope horse hot hour house how huge human hunt ice idea if in inch into iron is it
item ivy jam jet job join joke jump just keep key kid kind king kiss kite knee knew knife know lake lamp land lane large last late laugh
law lay lead leaf lean leap learn left leg lemon lend less let life light like line link lion list live load lock log long look loose lose
lost lot love low luck made mail main make man many map mark mass match may maze me meal mean meat meet melt men mind mine mint miss mist
mix moon more most move much mud must my nail name near neat need nest net new next nice night nine no node none north nose not note now
nut oak odd off often oil old on once one only open or orange order other our out over own pace pack page pain paint pair pale pan park
part pass path pay peace peak pear pen pet pick pie pig pin pine pink place plain plane plant play plot point pond pool poor pop port post
pour power press price pride prime print prize pull pure push put quick quiet race rain raise ran rate read real red rest rice rich ride
right ring rise river road rock roll roof room root rope rose round row run safe said sail salt same sand save saw say scale sea seal seat
see seed seem seen send set shade shake shall shape share shark sharp she sheep shell ship shirt shoe shop shore short shot show shut side
sign silk sing sit six size sky sleep slide slow small smart smile smoke snow so soft soil some song soon sound soup south space spare spin
sport spot star start state stay steam steel step stick still stone stop store storm story street strong sun sure swim table tail take talk
tall tape task tea team tear tell ten tend tent than thank that the their them then there they thin thing think this three throw tide tie
time tiny to toast today told tone too tool top town track trade train trap tree trick trip true try turn two under unit up use van vast
very view vine visit voice wait walk wall want warm was wash watch water wave way weak wear weed week well went were west wet what when
where which white who why wide wife wild will wind wine wing winter wire wish with wolf wood word work world would write yard year yes yet
you young your zero zone
`.trim().split(/\s+/).filter(w => w.length >= 3 && w.length <= 8);

const totalWeight = LETTER_WEIGHTS.reduce((sum, [, weight]) => sum + weight, 0);

export function weightedLetter(random = Math.random) {
  let pick = random() * totalWeight;
  for (const [letter, weight] of LETTER_WEIGHTS) {
    pick -= weight;
    if (pick <= 0) return letter;
  }
  return "E";
}

export function areAdjacent(a, b, size = 4) {
  const ar = Math.floor(a / size), ac = a % size;
  const br = Math.floor(b / size), bc = b % size;
  return a !== b && Math.abs(ar - br) <= 1 && Math.abs(ac - bc) <= 1;
}

export function canTraceWord(board, word, size = 4) {
  const target = String(word).toUpperCase();
  if (!target || target.length > board.length) return false;

  const visit = (index, pos, used) => {
    if (board[index] !== target[pos]) return false;
    if (pos === target.length - 1) return true;
    used.add(index);
    for (let next = 0; next < board.length; next++) {
      if (!used.has(next) && board[next] === target[pos + 1] && areAdjacent(index, next, size)) {
        if (visit(next, pos + 1, used)) { used.delete(index); return true; }
      }
    }
    used.delete(index);
    return false;
  };

  for (let i = 0; i < board.length; i++) {
    if (board[i] === target[0] && visit(i, 0, new Set())) return true;
  }
  return false;
}

function boardQuality(board) {
  const vowelCount = board.filter(letter => VOWELS.has(letter)).length;
  const rareCount = board.filter(letter => RARE.has(letter)).length;
  const uniqueCount = new Set(board).size;
  let score = 0;

  // Strong preference for 5–7 vowels, a healthy amount of letter variety, and
  // few rare letters. These priors substantially reduce unplayable boards.
  score -= Math.abs(vowelCount - 6) * 9;
  score += Math.min(uniqueCount, 12) * 1.5;
  score -= Math.max(0, rareCount - 1) * 10;

  // Reward boards on which common words can actually be traced. Longer words
  // count more, but short-word density also matters for fast casual play.
  for (const word of COMMON_WORDS) {
    if (canTraceWord(board, word)) score += 1.2 + Math.pow(word.length, 1.55);
  }
  return score;
}

function improveQ(board) {
  const qIndex = board.indexOf("Q");
  if (qIndex < 0) return board;
  const neighbors = board.map((_, i) => i).filter(i => areAdjacent(qIndex, i));
  if (!neighbors.some(i => board[i] === "U")) {
    const replace = neighbors.find(i => !VOWELS.has(board[i]) && !RARE.has(board[i]));
    if (replace !== undefined) board[replace] = "U";
  }
  return board;
}

export function generateBoard({ candidates = 28, random = Math.random } = {}) {
  let best = null;
  let bestScore = -Infinity;
  for (let c = 0; c < candidates; c++) {
    const board = improveQ(Array.from({ length: 16 }, () => weightedLetter(random)));
    const quality = boardQuality(board);
    if (quality > bestScore) {
      best = board;
      bestScore = quality;
    }
  }
  return best;
}

export function scoreWord(word) {
  const length = typeof word === "number" ? word : String(word).length;
  if (length < 3) return 0;
  if (length === 3) return 100;
  if (length === 4) return 300;
  if (length === 5) return 600;
  if (length === 6) return 1000;
  if (length === 7) return 1500;
  return 2200 + Math.max(0, length - 8) * 400;
}

export function sanitizeRoomCode(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 1);
}

export function makeRoomCode(random = Math.random) {
  const codes = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const index = Math.min(codes.length - 1, Math.floor(random() * codes.length));
  return codes[index];
}
