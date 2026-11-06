// 斗地主 rules: the cards, what a play is, what beats what, hints and the
// computer players, with 赖子 (a wild rank). Plain JavaScript shared by the
// server (node) and the game window (the mod).
//
// Cards are 0..53: 0..51 are 3♠ 3♥ 3♣ 3♦ 4♠ ... 2♦, 52 the small joker,
// 53 the big one. Ranks run 3..15 (11 J, 12 Q, 13 K, 14 A, 15 2), 16 and 17
// for the jokers. `wild` is the 赖子 rank (3..15) or null: its four cards
// can stand for any rank 3..15 (never a joker), or for themselves.
//
// Bombs, low to high: 软炸 (made with 赖子) < 硬炸 (four real cards) <
// 赖子炸 (all four 赖子) < 王炸.

export const LABEL = { 11: "J", 12: "Q", 13: "K", 14: "A", 15: "2", 16: "小王", 17: "大王" };
export const SUITS = ["♠", "♥", "♣", "♦"];

export const rank = (id) => (id >= 52 ? id - 36 : Math.floor(id / 4) + 3);
export const suit = (id) => (id >= 52 ? null : id % 4);
export const isRed = (id) => id === 53 || (id < 52 && id % 2 === 1);
export const rankLabel = (r) => LABEL[r] ?? String(r);
export const label = (id) => rankLabel(rank(id));
export const isWild = (id, wild) => wild != null && id < 52 && rank(id) === wild;

/** Highest first, as a hand is held; 赖子 at the front. */
export const sortHand = (ids, wild = null) =>
  [...ids].sort((a, b) => (isWild(b, wild) - isWild(a, wild)) || rank(b) - rank(a) || b - a);

export const NAMES = {
  single: "单张", pair: "对子", triple: "三张", triple1: "三带一", triple2: "三带一对",
  straight: "顺子", pairs: "连对", plane: "飞机", plane1: "飞机带翅膀", plane2: "飞机带翅膀",
  four2: "四带二", four22: "四带两对", bomb: "炸弹", rocket: "王炸",
};
export const BOMB_NAMES = { soft: "软炸", hard: "硬炸", wild: "赖子炸弹" };

const consecutive = (rs) => rs.length > 0 && rs[rs.length - 1] <= 14 && rs.every((r, i) => i === 0 || r === rs[i - 1] + 1);

/** What ranks make as a play: { type, main, n }, or null. */
function shape(ranksList) {
  const n = ranksList.length;
  const cnt = new Map();
  for (const r of ranksList) cnt.set(r, (cnt.get(r) ?? 0) + 1);
  const ranks = [...cnt.keys()].sort((a, b) => a - b);
  const of = (k) => ranks.filter((r) => cnt.get(r) === k);
  if (n === 2 && cnt.has(16) && cnt.has(17)) return { type: "rocket", main: 17, n };
  if (cnt.size === 1) {
    const type = { 1: "single", 2: "pair", 3: "triple", 4: "bomb" }[n];
    return type ? { type, main: ranks[0], n } : null;
  }
  if (n === 4 && of(3).length === 1) return { type: "triple1", main: of(3)[0], n };
  if (n === 5 && of(3).length === 1 && of(2).length === 1) return { type: "triple2", main: of(3)[0], n };
  if (n >= 5 && of(1).length === n && consecutive(ranks)) return { type: "straight", main: ranks[n - 1], n };
  if (n >= 6 && of(2).length === n / 2 && consecutive(ranks)) return { type: "pairs", main: ranks[ranks.length - 1], n };
  if (of(4).length === 1) {
    if (n === 6) return { type: "four2", main: of(4)[0], n };
    if (n === 8 && of(2).length === 2) return { type: "four22", main: of(4)[0], n };
  }
  const threes = ranks.filter((r) => cnt.get(r) >= 3);
  for (let k = Math.floor(n / 3); k >= 2; k--) {
    for (let i = 0; i + k <= threes.length; i++) {
      const run = threes.slice(i, i + k);
      if (!consecutive(run)) continue;
      const rest = n - 3 * k, main = run[k - 1];
      if (rest === 0) return { type: "plane", main, n };
      if (rest === k) return { type: "plane1", main, n };
      if (rest === 2 * k) {
        const left = new Map(cnt);
        for (const r of run) left.set(r, left.get(r) - 3);
        if ([...left.values()].every((c) => c % 2 === 0)) return { type: "plane2", main, n };
      }
    }
  }
  return null;
}

/** 0 for a plain play, else how strong a bomb it is: 软炸 1, 硬炸 2, 赖子炸 3, 王炸 4. */
export const power = (c) => (!c ? 0 : c.type === "rocket" ? 4 : c.type === "bomb" ? { soft: 1, hard: 2, wild: 3 }[c.kind] : 0);

/**
 * Every way a set of cards is a play, each { type, main, n, kind?, as }
 * (`as`: what each 赖子 stood for, by card id).
 */
export function readings(ids, wild = null) {
  if (!ids.length) return [];
  const wilds = ids.filter((id) => isWild(id, wild));
  const plain = ids.filter((id) => !isWild(id, wild)).map(rank);
  const out = [];
  const seen = new Set();
  const choose = (k, acc) => {
    if (k === wilds.length) {
      const c = shape([...plain, ...acc]);
      if (!c) return;
      const as = {};
      wilds.forEach((id, j) => { as[id] = acc[j]; });
      if (c.type === "bomb") {
        const subbed = wilds.some((id, j) => acc[j] !== wild);
        c.kind = wilds.length === 4 ? "wild" : subbed ? "soft" : "hard";
      }
      const key = `${c.type}:${c.main}:${c.kind ?? ""}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ ...c, as });
      return;
    }
    // Ascending and non-decreasing: the same reading only once.
    for (let r = acc.length ? acc[acc.length - 1] : 3; r <= 15; r++) choose(k + 1, [...acc, r]);
  };
  choose(0, []);
  return out;
}

/** Whether play `c` may follow `last` (null: a free lead). */
export function beats(c, last) {
  if (!c) return false;
  if (!last) return true;
  const pc = power(c), pl = power(last);
  if (pc || pl) return pc > pl || (pc === pl && pc < 4 && c.main > last.main);
  return c.type === last.type && c.n === last.n && c.main > last.main;
}

/**
 * The play some cards make after `last`: the reading that beats it, the
 * lowest that does; on a free lead the strongest (a bomb before the same
 * cards as a triple and a kicker). null when no reading is legal.
 */
export function analyze(ids, wild = null, last = null) {
  const rs = readings(ids, wild).filter((c) => beats(c, last));
  if (!rs.length) return null;
  if (last) return rs.sort((a, b) => power(a) - power(b) || a.main - b.main)[0];
  return rs.sort((a, b) => power(b) - power(a) || b.main - a.main)[0];
}

// ---- hints

/** Natural cards by rank (赖子 kept apart). */
function groups(hand, wild) {
  const g = new Map();
  for (const id of hand) {
    if (isWild(id, wild)) continue;
    const r = rank(id);
    if (!g.has(r)) g.set(r, []);
    g.get(r).push(id);
  }
  return g;
}

/**
 * Cards for a body (rank → count), real cards first and 赖子 for what's
 * missing. Real bombs aren't broken unless the body asks for four.
 * { ids, wilds } or null.
 */
function fill(g, wildIds, body) {
  const ids = [];
  let need = 0;
  for (const [r, k] of body) {
    const have = g.get(r) ?? [];
    if (r >= 16) {
      if (have.length < k) return null;
      ids.push(...have.slice(0, k));
      continue;
    }
    const usable = have.length === 4 && k < 4 ? [] : have;
    const take = Math.min(k, usable.length);
    ids.push(...usable.slice(0, take));
    need += k - take;
  }
  if (need > wildIds.length) return null;
  return { ids: [...ids, ...wildIds.slice(0, need)], wilds: need };
}

/** `k` kickers of `size` real cards from ranks outside the body: whole groups first, low first. */
function kickers(g, used, k, size) {
  const rs = [...g.keys()]
    .filter((r) => !used.has(r) && g.get(r).length >= size && g.get(r).length < 4)
    .sort((a, b) => (g.get(a).length === size ? 0 : 1) - (g.get(b).length === size ? 0 : 1) || a - b);
  return rs.length < k ? null : rs.slice(0, k).flatMap((r) => g.get(r).slice(0, size));
}

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

/** Bodies of a play type above `main`: [rank → count, kicker count, kicker size]. */
function bodies(type, n, main) {
  const out = [];
  const one = (k) => { for (const r of range(Math.max(3, main + 1), 17)) if (k === 1 || r <= 15) out.push([new Map([[r, k]]), 0, 0]); };
  switch (type) {
    case "single": one(1); break;
    case "pair": one(2); break;
    case "triple": one(3); break;
    case "triple1": for (const r of range(Math.max(3, main + 1), 15)) out.push([new Map([[r, 3]]), 1, 1]); break;
    case "triple2": for (const r of range(Math.max(3, main + 1), 15)) out.push([new Map([[r, 3]]), 1, 2]); break;
    case "straight":
    case "pairs":
    case "plane":
    case "plane1":
    case "plane2": {
      const per = { straight: 1, pairs: 2, plane: 3, plane1: 3, plane2: 3 }[type];
      const k = n / { straight: 1, pairs: 2, plane: 3, plane1: 4, plane2: 5 }[type];
      for (let s = 3; s + k - 1 <= 14; s++) {
        if (s + k - 1 <= main) continue;
        const body = new Map(range(s, s + k - 1).map((r) => [r, per]));
        out.push([body, type === "plane1" || type === "plane2" ? k : 0, type === "plane2" ? 2 : 1]);
      }
      break;
    }
    default: break;
  }
  return out;
}

function make(g, wildIds, [body, kn, ks]) {
  const f = fill(g, wildIds, body);
  if (!f) return null;
  if (!kn) return f;
  const k = kickers(g, new Set(body.keys()), kn, ks);
  return k ? { ids: [...f.ids, ...k], wilds: f.wilds } : null;
}

/** Bombs: soft, hard, all-赖子, then the rocket; above `last` when it is one. */
function bombs(g, wildIds, wild, last) {
  const found = [];
  for (const r of range(3, 15)) {
    const f = fill(g, wildIds, new Map([[r, 4]]));
    if (f) found.push(f.ids);
  }
  if (wildIds.length === 4) found.push(wildIds);
  if (g.has(16) && g.has(17)) found.push([g.get(16)[0], g.get(17)[0]]);
  return found.map((ids) => ({ ids, c: analyze(ids, wild, last) })).filter((x) => x.c && power(x.c))
    .sort((a, b) => power(a.c) - power(b.c) || a.c.main - b.c.main).map((x) => x.ids);
}

/** A free lead: the lowest group as it stands (a triple takes a kicker), then 赖子, bombs last. */
function leads(g, wildIds) {
  const out = [];
  const asc = [...g.keys()].sort((a, b) => a - b);
  for (let len = 12; len >= 5; len--) {
    const s = asc[0];
    if (s + len - 1 > 14) continue;
    const f = fill(g, [], new Map(range(s, s + len - 1).map((r) => [r, 1])));
    if (f) { out.push(f.ids); break; }
  }
  for (const r of asc) {
    const c = g.get(r);
    if (c.length === 4 || (r >= 16 && g.has(16) && g.has(17))) continue;
    if (c.length === 3) {
      const k1 = kickers(g, new Set([r]), 1, 1);
      const k2 = kickers(g, new Set([r]), 1, 2);
      if (k1 && rank(k1[0]) < 15) out.push([...c, ...k1]);
      else if (k2) out.push([...c, ...k2]);
      else out.push(c);
    } else out.push(c);
  }
  if (wildIds.length && wildIds.length < 4) out.push(wildIds.slice(0, 1));
  return out;
}

/** Every suggested play for `hand` after `last` (null: a free lead), best first. */
export function options(hand, last, wild = null) {
  const g = groups(hand, wild);
  const wildIds = hand.filter((id) => isWild(id, wild));
  const out = [];
  const all = analyze(hand, wild, last);
  if (all && all.type !== "four2" && all.type !== "four22") out.push([...hand]);
  if (!last) out.push(...leads(g, wildIds), ...bombs(g, wildIds, wild, null));
  else if (last.type !== "rocket") {
    if (!power(last)) {
      const made = bodies(last.type, last.n, last.main).map((b) => make(g, wildIds, b)).filter(Boolean);
      made.sort((a, b) => a.wilds - b.wilds);
      out.push(...made.map((m) => m.ids));
    }
    out.push(...bombs(g, wildIds, wild, last));
  }
  const seen = new Set();
  return out.filter((ids) => {
    const k = [...ids].sort((a, b) => a - b).join(",");
    if (seen.has(k)) return false;
    seen.add(k);
    return Boolean(analyze(ids, wild, last));
  });
}

// ---- computer players

/** A bid of 0..3 for a hand, above `top` or 0. */
export function botBid(hand, top, wild = null) {
  const g = groups(hand, wild);
  let s = hand.filter((id) => isWild(id, wild)).length * 2;
  if (g.has(17)) s += 4;
  if (g.has(16)) s += 3;
  s += (g.get(15)?.length ?? 0) * 2;
  for (const c of g.values()) if (c.length === 4) s += 4;
  const bid = s >= 12 ? 3 : s >= 9 ? 2 : s >= 6 ? 1 : 0;
  return bid > top ? bid : 0;
}

/**
 * A computer player's (or 托管's) play: cards, or null to pass. `mate`: the
 * last play is a teammate's; `threat`: the card count of the player to beat.
 */
export function botPlay(hand, last, mate, threat, wild = null) {
  const opts = options(hand, last, wild);
  if (!opts.length) return null;
  if (opts[0].length === hand.length) return opts[0];
  if (!last) {
    // Keep 赖子 and bombs for later while there's anything else.
    return opts.find((o) => !o.some((id) => isWild(id, wild)) && !power(analyze(o, wild))) ?? opts[0];
  }
  if (mate) return null;
  const plain = opts.find((o) => !power(analyze(o, wild, last)));
  if (plain) return plain;
  return threat <= 6 ? opts[0] : null;
}
