import { game ,gameUI } from './gameUI.js';
import Sound from './sounds.js';

class GameOverUI
{
    constructor() {
        this.highScoreDisplay = document.getElementById('gameover-score-display');
        this.levelDisplay = document.getElementById('gameover-level-display');
    }

    // This will be called when game over screen is opened
    onShow() {
        gameUI.playEffect(Sound.GAMEOVER);
        this.highScoreDisplay.textContent = game.score;
        this.levelDisplay.textContent = game.level;
    }
}

const gameoverUI = new GameOverUI();

export {gameoverUI}