function start_screen()
{
//#   Prints the start screen and get info from user about file path and the index of the word.
//#   file_path: string
//#   word_number: int
    console.log(`Welcome to the game Hangman 
     _    _
    | |  | |
    | |__| | __ _ _ __   __ _ _ __ ___   __ _ _ __
    |  __  |/ _' | '_ \\ / _' | '_ ' _ \\ / _' | '_ \\   
    | |  | | (_| | | | | (_| | | | | | | (_| | | | |  
    |_|  |_|\\__,_|_| |_|\\__, |_| |_| |_|\\__,_|_| |_|  
                         __/ |                        
                        |___/                         
    `)
    //file_path = input("Write the name of the word bank(The file path(str)):")
    //word_number = int(input("Write the index of the word(int):"))
    //console.log("\nLet's start!\n")
    //print_hangman(1)
    //return file_path, word_number
}

function main()
{
    choose_word_parameters = start_screen()
}

main();