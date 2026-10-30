// Anything taken for points: a coin, a gem, whatever a pack draws. Objects of
// this class differ only by their props — the sprite, the score, the sound —
// and `tally`, the count it adds to for the achievements (Coin Collector
// counts coins, Gem Hunter gems). Gems were a class of their own once, on the
// glyph G; game.js still reads an old G block as the pack's gem.
class Treasure extends Pickup {
  static bucket = 'coins';
  static editor = {
    label: 'Treasure',
    code: '0C',
    props: {
      score: { type: 'int', default: 1, label: 'Score', group: 'Taken', short: 'Score' },
      pickSound: { type: 'sound', default: 'sound::coin', label: 'Sound when taken', group: 'Taken', short: 'Sound' },
      tally: { type: 'choice', options: ['coins', 'gems', 'none'], default: 'coins', label: 'Counts toward the achievements as', group: 'Taken', short: 'Counts as' }
    }
  };

  take() {
    this.popT = 0;
    score += this.props.score;
    if (this.props.tally === 'coins' || this.props.tally === 'gems') {
      stats[this.props.tally]++;
      saveStats();
      checkStatAchievements();
    }
    playSound(this.props.pickSound);
  }
}
