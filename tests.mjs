import assert from "node:assert/strict";
import { areAdjacent, canTraceWord, generateBoard, makeRoomCode, sanitizeRoomCode, scoreWord } from "./game-core.js";

assert.equal(areAdjacent(0, 1), true);
assert.equal(areAdjacent(0, 4), true);
assert.equal(areAdjacent(0, 5), true);
assert.equal(areAdjacent(3, 4), false, "row wrap must not count as adjacency");
assert.equal(areAdjacent(5, 10), true);
assert.equal(areAdjacent(5, 5), false);

const board = [
  "C","A","T","S",
  "R","E","D","O",
  "B","I","R","D",
  "L","O","G","S"
];
assert.equal(canTraceWord(board, "cat"), true);
assert.equal(canTraceWord(board, "care"), true);
assert.equal(canTraceWord(["A", ...Array(15).fill("B")], "aba"), false, "a tile cannot be reused");

assert.equal(scoreWord("cat"), 100);
assert.equal(scoreWord("four"), 300);
assert.equal(scoreWord("eightaaa"), 2200);
assert.equal(scoreWord("ninechars"), 2600);

assert.equal(sanitizeRoomCode(" 7 "), "7");
assert.equal(sanitizeRoomCode("room 42"), "R");
assert.equal(sanitizeRoomCode(" z "), "Z");
assert.equal(sanitizeRoomCode("@ b !"), "B");
assert.equal(makeRoomCode(() => 0), "0");
assert.equal(makeRoomCode(() => 10 / 36), "A");
assert.equal(makeRoomCode(() => 0.999999), "Z");

const allRoomCodes = new Set(
  Array.from({ length: 36 }, (_, i) => makeRoomCode(() => (i + 0.01) / 36))
);
assert.equal(allRoomCodes.size, 36, "room generator should cover 0-9 and A-Z");
assert.ok([...allRoomCodes].every(code => /^[A-Z0-9]$/.test(code)));

for (let i = 0; i < 12; i++) {
  const generated = generateBoard({ candidates: 4 });
  assert.equal(generated.length, 16);
  assert.ok(generated.every(letter => /^[A-Z]$/.test(letter)));
}

console.log("All WordGrid core tests passed.");
