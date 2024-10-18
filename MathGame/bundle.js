(() => {
  // GameClass/highscore.js
  var HighScoreManager = class {
    constructor() {
      this.highScoreKey = "gameHighScore";
      this.levelKey = "gameLevel";
      this.highScore = 0;
      this.level = 0;
      this.load();
    }
    // Load the high score from local storage
    load() {
      const storedHighScore = localStorage.getItem(this.highScoreKey);
      this.highScore = storedHighScore ? parseInt(storedHighScore, 10) : 0;
      const storedLevel = localStorage.getItem(this.levelKey);
      this.level = storedLevel ? parseInt(storedLevel, 10) : 0;
    }
    // Get the current high score
    getHighScore() {
      return this.highScore;
    }
    // Get the current level
    getLevel() {
      return this.level;
    }
    // Set a new score, update if it's higher than the current high score
    set(newScore, newLevel) {
      if (newScore >= this.highScore) {
        this.highScore = newScore;
        if (newLevel > this.level)
          this.level = newLevel;
        this.save();
      }
    }
    // Save the high score to local storage
    save() {
      localStorage.setItem(this.highScoreKey, this.highScore);
      localStorage.setItem(this.levelKey, this.level);
    }
    // Reset the high score
    reset() {
      this.highScore = 0;
      this.level = 0;
      this.save();
    }
  };
  var highscore_default = HighScoreManager;

  // GameClass/highscoreUI.js
  var HighScoreUI = class {
    constructor(highScoreManager2) {
      this.highScoreManager = highScoreManager2;
      this.highScoreDisplay = document.getElementById("high-score-display");
      this.levelDisplay = document.getElementById("level-display");
    }
    // Update the high score UI
    updateHighScore() {
      this.highScoreDisplay.textContent = `High Score: ${this.highScoreManager.getHighScore()}`;
      this.levelDisplay.textContent = `Level: ${this.highScoreManager.getLevel()}`;
    }
    // This will be called when the high score screen is opened
    onShow() {
      this.updateHighScore();
    }
  };
  var TestHighScore = class {
    constructor(highScoreManager2) {
      this.highScoreManager = highScoreManager2;
      this.scoreInput = document.getElementById("test-score-input");
      this.levelInput = document.getElementById("test-level-input");
      this.setScoreBtn = document.getElementById("set-score-btn");
      this.resetTestHighScoreBtn = document.getElementById("reset-test-highscore");
      this.setScoreBtn.addEventListener("click", () => this.setScore());
      this.resetTestHighScoreBtn.addEventListener("click", () => this.resetHighScore());
    }
    // Set a new score using the input value
    setScore() {
      const newScore = parseInt(this.scoreInput.value, 10);
      const newLevel = parseInt(this.levelInput.value, 10);
      if (!isNaN(newScore) && !isNaN(newLevel)) {
        this.highScoreManager.set(newScore, newLevel);
      }
      this.updateUI();
    }
    // Reset the high score
    resetHighScore() {
      this.highScoreManager.reset();
      this.updateUI();
    }
    updateUI() {
      this.scoreInput.value = this.highScoreManager.getHighScore();
      this.levelInput.value = this.highScoreManager.getLevel();
    }
    // Called when the test screen is opened (if any setup is needed)
    onShow() {
      this.updateUI();
    }
  };
  var highScoreManager = new highscore_default();
  var highScoreUI = new HighScoreUI(highScoreManager);
  var testHighScore = new TestHighScore(highScoreManager);

  // GameClass/game.js
  var SUCCESS = "Assets/success-1-6297.mp3";
  var Game = class {
    constructor() {
      this.initialSpawnRate = 1e4;
      this.init();
    }
    init() {
      this.score = 0;
      this.exercises = [];
      this.level = 1;
      this.gameOver = false;
      this.spawnRate = this.initialSpawnRate;
      this.maxExercises = 10;
      this.initialExercises = 3;
      this.exerciseInterval;
    }
    start() {
      this.gameUI.playSound();
      this.init();
      this.gameUI.clearExercise();
      this.gameUI.updateScore();
      this.startLevel();
    }
    randomNum(min, max) {
      return Math.floor(Math.random() * (max - min + 1)) + min;
    }
    checkAnswer(playerAnswer, exerciseId, correctAnswer) {
      if (playerAnswer === correctAnswer) {
        this.gameUI.playEffect(SUCCESS);
        this.exercises = this.exercises.filter((id) => id !== exerciseId);
        this.gameUI.removeExercise(exerciseId);
        this.score++;
        this.gameUI.updateScore();
        if (this.exercises.length == 0)
          this.levelUp();
      }
    }
    addExercise() {
      if (this.gameOver) return;
      if (this.exercises.length >= this.maxExercises) {
        this.endGame();
        return;
      }
      var exercise = {};
      const num1 = this.randomNum(1, 10);
      const num2 = this.randomNum(1, 10);
      exercise.num1 = num1;
      exercise.num2 = num2;
      exercise.answer = num1 * num2;
      const exerciseId = this.gameUI.addExercise(exercise);
      this.exercises.push(exerciseId);
    }
    levelUp() {
      this.level++;
      this.spawnRate -= 500;
      if (this.spawnRate < 1e3) this.spawnRate = 1e3;
      this.gameUI.startCountdown(this.startLevel.bind(this));
    }
    startLevel() {
      this.exercises = [];
      this.gameUI.clearExercise();
      this.gameUI.updateLevel();
      for (let i = 0; i < this.initialExercises; i++) {
        this.addExercise();
      }
      clearInterval(this.exerciseInterval);
      this.exerciseInterval = setInterval(this.addExercise.bind(this), this.spawnRate);
    }
    endGame() {
      highScoreManager.set(this.score, this.level);
      clearInterval(this.exerciseInterval);
      this.gameOver = true;
      showScreen("gameover-screen");
      this.exercises = [];
      this.gameUI.clearExercise();
      this.gameUI.stopSound();
    }
  };
  var game_default = Game;

  // GameClass/Sounds.js
  var Sound = {
    SUCCESS: "Assets/success-1-6297.mp3",
    COUNTDOWN: "Assets/countdown-sound-effect-8-bit-151797.mp3",
    GAMEOVER: "Assets/brass-fail-11-a-207140.mp3"
  };
  var Sounds_default = Sound;

  // GameClass/gameUI.js
  var GameUI = class {
    constructor(game2) {
      game2.gameUI = this;
      this.game = game2;
      this.countdownDisplay = document.getElementById("countdown-display");
      this.intervalId = null;
      this.gameContainer = document.getElementById("game-container");
      this.incId = 0;
      document.getElementById("game-container").addEventListener("input", (e) => {
        if (e.target.classList.contains("answer")) {
          checkAnswer(e.target);
        }
      });
    }
    removeExercise(exerciseId) {
      document.getElementById(exerciseId).classList.add("fade-out");
      setTimeout(() => {
        document.getElementById(exerciseId).remove();
      }, 300);
    }
    updateScore() {
      document.getElementById("score-value").textContent = this.game.score;
    }
    updateLevel() {
      document.getElementById("level-value").textContent = this.game.level;
    }
    addExercise(e) {
      const exerciseId = `exercise-${++this.incId}`;
      const div = document.createElement("div");
      div.className = "exercise";
      div.id = exerciseId;
      div.innerHTML = `${e.num1} x ${e.num2} = <input type="number" class="answer" data-answer="${e.answer}" data-id="${exerciseId}">`;
      this.gameContainer.appendChild(div);
      return exerciseId;
    }
    clearExercise() {
      this.gameContainer.innerHTML = "";
    }
    updateCountDown(count) {
      this.countdown = count;
      this.countdownDisplay.innerHTML = `<span>Level:${this.game.level}<br/>${count.toString()}</span>`;
    }
    startCountdown(onCountDownFinishFunction) {
      this.updateCountDown(3);
      this.playEffect(Sounds_default.COUNTDOWN);
      this.countdownDisplay.style.display = "flex";
      clearInterval(this.intervalId);
      this.intervalId = setInterval(() => {
        this.updateCountDown(this.countdown - 1);
        if (this.countdown == 0) {
          clearInterval(this.intervalId);
          this.countdownDisplay.style.display = "none";
          onCountDownFinishFunction();
        }
      }, 1e3);
    }
    // Called when the test screen is opened (if any setup is needed)
    onShow() {
      this.startCountdown(this.game.start.bind(this.game));
    }
    playEffect(name) {
      var e_effect = document.getElementById("effect");
      var audio = document.getElementById("mp3Effect");
      audio.src = name;
      e_effect.load();
      e_effect.sorce;
      e_effect.volume = 1;
      e_effect.play();
    }
    stopEffect() {
      var e_effect = document.getElementById("effect");
      e_effect.pause();
      e_effect.currentTime = 0;
    }
    playSound() {
      var e_snd = document.getElementById("snd");
      e_snd.volume = 0.2;
      e_snd.play();
    }
    stopSound() {
      var e_snd = document.getElementById("snd");
      e_snd.pause();
      e_snd.currentTime = 0;
    }
  };
  var game = new game_default();
  var gameUI = new GameUI(game);
  function checkAnswer(input) {
    const playerAnswer = parseInt(input.value);
    const correctAnswer = parseInt(input.dataset.answer);
    const exerciseId = input.dataset.id;
    game.checkAnswer(playerAnswer, exerciseId, correctAnswer);
  }

  // GameClass/gameoverUI.js
  var GameOverUI = class {
    constructor() {
      this.highScoreDisplay = document.getElementById("gameover-score-display");
      this.levelDisplay = document.getElementById("gameover-level-display");
    }
    // This will be called when game over screen is opened
    onShow() {
      gameUI.playEffect(Sounds_default.GAMEOVER);
      this.highScoreDisplay.textContent = game.score;
      this.levelDisplay.textContent = game.level;
    }
  };
  var gameoverUI = new GameOverUI();

  // GameClass/optionsUI.js
  var OPTION_EASY = 1e4;
  var OPTION_MEDIUM = 6e3;
  var OPTION_HARD = 3e3;
  var OptionsUI = class {
    constructor() {
      this.easyBtn = document.getElementById("options-easy");
      this.mediumBtn = document.getElementById("options-medium");
      this.hardBtn = document.getElementById("options-hard");
      this.btnList = [this.easyBtn, this.mediumBtn, this.hardBtn];
      this.optionList = [OPTION_EASY, OPTION_MEDIUM, OPTION_HARD];
      for (let i = 0; i < this.btnList.length; i++)
        this.btnList[i].addEventListener("click", () => this.select(i));
    }
    select(value) {
      this.setOption(this.optionList[value]);
      for (let i = 0; i < this.btnList.length; i++) {
        if (i == value)
          this.btnList[i].classList.add("select");
        else
          this.btnList[i].classList.remove("select");
      }
    }
    setOption(value) {
      game.initialSpawnRate = value;
    }
    // This will be called when game over screen is opened
    onShow() {
      for (let i = 0; i < this.optionList.length; i++) {
        if (game.initialSpawnRate == this.optionList[i]) {
          this.select(i);
          break;
        }
      }
    }
  };
  var optionsUI = new OptionsUI();

  // gamemanager.js
  function showScreen2(screenId) {
    document.querySelectorAll(".screen").forEach((screen2) => {
      screen2.classList.remove("active");
    });
    const screen = document.getElementById(screenId);
    screen.classList.add("active");
    if (screenId === "highscore-screen") {
      highScoreUI.onShow();
    } else if (screenId === "game-screen") {
      gameUI.onShow();
    } else if (screenId === "test-highscore-screen") {
      testHighScore.onShow();
    } else if (screenId === "gameover-screen") {
      gameoverUI.onShow();
    } else if (screenId === "options-screen") {
      optionsUI.onShow();
    }
  }
  document.addEventListener("DOMContentLoaded", () => {
    showScreen2("open-screen");
  });
  window.showScreen = showScreen2;
})();
