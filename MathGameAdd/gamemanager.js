import { highScoreUI, testHighScore } from './GameClass/highscoreUI.js';
import { gameUI } from './GameClass/gameUI.js';
import { gameoverUI } from './GameClass/gameoverUI.js';
import { optionsUI } from './GameClass/optionsUI.js';
import { rangeUI } from './GameClass/rangeUI.js';

// Hook into the showScreen function to call the appropriate UI class when screens are shown
export function showScreen(screenId) {
    // Hide all screens
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active');
    });

    // Show the selected screen
    const screen = document.getElementById(screenId);
    screen.classList.add('active');

    //Call the UI class onShow method if it exists
    if (screenId === 'highscore-screen') {
        highScoreUI.onShow();
    } else if (screenId === 'game-screen') {
        gameUI.onShow();
    } else if (screenId === 'test-highscore-screen') {
        testHighScore.onShow();
    } else if (screenId === 'gameover-screen') {
        gameoverUI.onShow();
    } else if (screenId === 'options-screen') {
        optionsUI.onShow();
    } else if (screenId === 'range-screen') {
        rangeUI.onShow();
    }




}

document.addEventListener("DOMContentLoaded", () => {
    // Start with the open screen visible
    showScreen('open-screen');
});

window.showScreen = showScreen