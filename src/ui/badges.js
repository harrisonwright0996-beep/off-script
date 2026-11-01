// What he has won: the streaks on Today, a moment when something new comes, and the Badges screen.
// Settings can turn all of it off.
import { h, plural, screen } from './dom.js';
import { BADGES, checkBadges, newRounds, statusOf, wordPercent } from '../streak.js';
import { weekday } from '../dates.js';

const FIRST = 'A round is 20 minutes of good practice. Two a day starts a bronze streak.';
const UNDERSTUDY = 'Miss a day and your understudy covers it, once a week, so your streak is safe.';

export function streakBlock(ctx) {
  const { rounds, minutes, next, more, medals } = statusOf(ctx.streak, ctx.today());
  const covered = medals.filter((m) => m.covered).pop();
  const fresh = !rounds && !minutes && !medals.some((m) => m.days);
  return h(
    'div',
    { class: 'streak' },
    h(
      'ul',
      { class: 'medals' },
      medals.map((m) => h('li', { class: m.days ? 'medal' : 'medal none' }, h('span', { class: 'medal-icon', 'aria-hidden': 'true' }, m.icon), h('strong', {}, m.name), h('span', {}, plural(m.days, 'day')))),
    ),
    fresh ? h('p', { class: 'help' }, FIRST) : h('p', { class: 'next-medal' }, next ? `${plural(more, 'more round')} for ${next.name.toLowerCase()} today` : 'Gold today. Brilliant work.'),
    minutes ? h('p', { class: 'help' }, `${minutes} of 20 minutes done in this round.`) : null,
    covered ? h('p', { class: 'help' }, `Your understudy covered ${weekday(covered.covered)} for your ${covered.name.toLowerCase()} streak.`) : null,
  );
}

// Anything won since the last look, or null. Marked as shown here, so it comes once.
export function rewardCard(ctx) {
  if (!ctx.settings.showStreaks) return null;
  const today = ctx.today();
  const percent = wordPercent(ctx.model.items, ctx.getState);
  const lit = ctx.model.scenes.some((sc) => sc.itemIds.length && wordPercent(ctx.model.items.filter((it) => it.scene === sc.index), ctx.getState) >= 100);
  const fresh = checkBadges(ctx.streak, { percent, lit, today });
  const won = newRounds(ctx.streak, today);
  ctx.saveStreak();
  const medal = won?.medal && statusOf(ctx.streak, today).medals.find((m) => m.name === won.medal.name);
  const words = [won ? `${won.rounds === 1 ? 'First round' : `Round ${won.rounds}`} done today.` : null, medal ? `${medal.icon} ${medal.name} streak: ${plural(medal.days, 'day')}.` : null, ...fresh.map((b) => `New badge: ${b.name}.`)].filter(Boolean);
  return words.length ? h('div', { class: 'reward', role: 'status' }, words.map((w) => h('p', {}, w))) : null;
}

export function showBadges(ctx) {
  const mine = new Set(ctx.streak.badges);
  ctx.root.append(
    screen({
      title: 'Badges',
      back: () => ctx.go('today'),
      body: [
        h('p', { class: 'lead' }, `${plural(mine.size, 'badge')} so far.`),
        h(
          'ul',
          { class: 'badge-list' },
          BADGES.map((b) => h('li', { class: mine.has(b.id) ? 'badge won' : 'badge' }, h('span', { 'aria-hidden': 'true' }, mine.has(b.id) ? '★' : '☆'), h('span', {}, h('strong', {}, b.name), h('span', { class: 'visually-hidden' }, mine.has(b.id) ? ', won' : ', not won yet'), h('span', { class: 'badge-what' }, b.what)))),
        ),
        h('h2', {}, 'Streaks'),
        h('p', {}, 'A round is 20 minutes of good practice, and it can be spread across the day. Two rounds a day is bronze, three is silver and four is gold.'),
        h('p', {}, UNDERSTUDY),
      ],
    }),
  );
}
