import { describe, it, expect } from 'vitest';
import { createParty, occupiedMembers, bankDeposit, bankWithdrawAll, totalBankedGold, divideXp } from '../PartyState.ts';
import { createCharacter } from '../CharacterState.ts';

function testParty(count: number) {
  return createParty(Array.from({ length: count }, (_, i) => createCharacter({ name: `Member ${i}` })));
}

describe('Bank — town-format.md §3.6', () => {
  it('withdraws every living member\'s banked gold into carried gold, zeroing each', () => {
    const party = testParty(3);
    const [a, b, c] = party.members;
    a!.bankedGold = 10;
    b!.bankedGold = 5;
    c!.bankedGold = 0;
    party.gold = 20;

    bankWithdrawAll(party);

    expect(party.gold).toBe(35);
    expect(a!.bankedGold).toBe(0);
    expect(b!.bankedGold).toBe(0);
    expect(c!.bankedGold).toBe(0);
  });

  it('does not withdraw a dead member\'s banked gold', () => {
    const party = testParty(2);
    const [a, b] = party.members;
    a!.bankedGold = 10;
    b!.bankedGold = 5;
    b!.alive = false;
    party.gold = 0;

    bankWithdrawAll(party);

    expect(party.gold).toBe(10);
    expect(b!.bankedGold).toBe(5); // untouched
  });

  it('deposits split evenly across living members, clamped to carried gold', () => {
    const party = testParty(3);
    party.gold = 100;

    bankDeposit(party, 30);

    expect(party.gold).toBe(70);
    expect(occupiedMembers(party).map((m) => m.bankedGold)).toEqual([10, 10, 10]);
  });

  it('distributes the division remainder one gold at a time to randomly-chosen members, not lost or dumped on one', () => {
    const party = testParty(3);
    party.gold = 100;
    const die = (n: number) => (n === 3 ? 2 : 1); // always picks member index 1 (0-based) for the remainder

    bankDeposit(party, 10, die); // share = 3, remainder = 1

    const totals = occupiedMembers(party).map((m) => m.bankedGold);
    expect(totals.reduce((a, b) => a + b, 0)).toBe(10); // nothing lost to integer division
    expect(totals[1]).toBe(4); // 3 share + 1 remainder
    expect(totals[0]).toBe(3);
    expect(totals[2]).toBe(3);
  });

  it('clamps a deposit larger than carried gold', () => {
    const party = testParty(2);
    party.gold = 5;

    bankDeposit(party, 999);

    expect(party.gold).toBe(0);
    expect(totalBankedGold(party)).toBe(5);
  });
});

describe('divideXp — town-format.md §3.7 mode 1', () => {
  it('is a two-pass split (pass 1: quotient random +1s; pass 2: weighted remainder) — small pass-2 rounding loss is inherent, not a bug', () => {
    const party = testParty(3);
    party.pendingXp = 30;
    const die = () => 1; // pass 1's random picks all land on member index 0

    divideXp(party, [1, 1, 1], die);

    // totalShares=3, quotient=floor(30/3)=10 (all to member 0 via the fixed die),
    // pool=20, perShare=floor(20/3)=6 each -> member0 = 10+6=16, others = 6.
    // 2 XP (20 - 3*6) is dropped by pass 2's own integer division, matching the confirmed algorithm.
    expect(occupiedMembers(party).map((m) => m.experience)).toEqual([16, 6, 6]);
    expect(party.pendingXp).toBe(0);
  });

  it('honours share weights in the second pass', () => {
    const party = testParty(3);
    party.pendingXp = 60;
    const die = () => 1; // pass 1's random picks all land on member index 0

    divideXp(party, [1, 2, 3], die);

    // totalShares=6, quotient=floor(60/6)=10 (all to member 0),
    // pool=50, perShare=floor(50/6)=8 -> member0 += 1*8=8, member1 += 2*8=16, member2 += 3*8=24.
    expect(occupiedMembers(party).map((m) => m.experience)).toEqual([18, 16, 24]);
  });

  it('pass 1 hands out exactly `quotient` individual +1s to random living members, ignoring weights', () => {
    const party = testParty(2);
    party.pendingXp = 4; // totalShares = 1+1 = 2 -> quotient = 2, pool after = 2, perShare = 1
    const die = () => 1; // always member index 0 for the random pass-1 increments
    divideXp(party, [1, 1], die);
    const [a, b] = occupiedMembers(party);
    // pass 1: +1, +1 both to member 0 (die always picks index 0) = 2
    // pass 2: perShare=1 * weight 1 each = +1 to both
    expect(a.experience).toBe(3);
    expect(b.experience).toBe(1);
  });

  it('excludes dead members entirely and still zeroes pendingXp with no living members', () => {
    const party = testParty(1);
    party.members[0]!.alive = false;
    party.pendingXp = 50;

    divideXp(party, []);

    expect(party.pendingXp).toBe(0);
    expect(party.members[0]!.experience).toBe(0);
  });
});
