// highscoreUI.js
import HighScoreManager from './highscore.js';

class HighScoreUI {
    constructor(highScoreManager) {
        this.highScoreManager = highScoreManager;
        this.highScoreDisplay = document.getElementById('high-score-display');
        this.levelDisplay = document.getElementById('level-display');
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
}

class TestHighScore {
    constructor(highScoreManager) {
        this.highScoreManager = highScoreManager;
        this.scoreInput = document.getElementById('test-score-input');
        this.levelInput = document.getElementById('test-level-input');
        this.setScoreBtn = document.getElementById('set-score-btn');
        this.resetTestHighScoreBtn = document.getElementById('reset-test-highscore');

        // Attach event listeners
        this.setScoreBtn.addEventListener('click', () => this.setScore());
        this.resetTestHighScoreBtn.addEventListener('click', () => this.resetHighScore());
    }

    // Set a new score using the input value
    setScore() {
        const newScore = parseInt(this.scoreInput.value, 10);
        const newLevel = parseInt(this.levelInput.value, 10);
        if (!isNaN(newScore) && !isNaN(newLevel)) {
            this.highScoreManager.set(newScore,newLevel);
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
        // Any additional UI setup for the test screen can go here
        this.updateUI();
    }
}


// Initialize the high score manager
const highScoreManager = new HighScoreManager();

// Create instances of UI classes for each screen
const highScoreUI = new HighScoreUI(highScoreManager);

// Create test instance for the HighScore class
const testHighScore = new TestHighScore(highScoreManager);

export { highScoreManager , highScoreUI, testHighScore };
