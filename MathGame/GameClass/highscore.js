// highscoreLogic.js
class HighScoreManager {
    constructor() {
        this.highScoreKey = 'gameHighScore';  // Key for storing high score in local storage
        this.levelKey = 'gameLevel';
        this.highScore = 0;
        this.level = 0;
        this.load();
    }

    // Load the high score from local storage
    load() {
        const storedHighScore = localStorage.getItem(this.highScoreKey);
        this.highScore =  storedHighScore ? parseInt(storedHighScore, 10) : 0;
        const storedLevel = localStorage.getItem(this.levelKey);
        this.level =  storedLevel ? parseInt(storedLevel, 10) : 0;
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
    set(newScore,newLevel) {
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
}

export default HighScoreManager;
