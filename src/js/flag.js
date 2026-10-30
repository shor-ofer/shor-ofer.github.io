// The level's finish. Its id picks which of the level's exits it leads to.
class Flag extends Entity {
  static bucket = 'finishPoints';
  static editor = { label: 'Flag', code: 'nF', props: {} };

}
