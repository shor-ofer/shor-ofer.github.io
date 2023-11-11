def check_win(secret_word, old_letters_guessed):
#     Checks if the whole secret word was guessted correctly
#    :param: secret_word: the word to be guessed
#    :param: old_lettes_guessed: the letters that were guessted (user's input)
#    :type secret_word: str
#    :type old_lettes_guessed: list
#    :return: True if the secret word was guessed, False if not
#    :rtype: boolean
    def inner_function(x):
        return x in old_letters_guessed
    bob = True
    for x in secret_word:
        bob = bob * inner_function(x)
    return bool(bob)

def choose_word(file_path, index):
#   Picks one word from a list of words, read from a file, according to a given index in the list
#   :param: file_path: the path of the file that contains a word list
#   :param: index: the position of the word to be picked
#   :type: file_path: string
#   :type: index: int
#   :return:the picked word
#   :rtype: str
    with open(file_path, "r") as file:
        openn = file.read()
        op = openn.split("\n")
        while index > len(op):
            index -= len(op)
        return (op[index-1])
    
def try_update_letter_guessed(letter_guessed, old_letters_guessed):
#    Checks validation of user’s input.
#    if so, adds it to "old_letters_guessed" and returns True. Otherwise  print "X" and old letters list returns
#    False.
#    :param letter_guessed: user’s input
#    :param old_letters_guessed: previous (valid) inputs
#    :type letter_guessed: string
#    :type old_letters_guessed: list
#    :return: True if input is valid, False if not.
#    :rtype: boolean
    letter_count = len(str(letter_guessed)) == 1
    letters_check = str(letter_guessed).isalpha()
    letters_list = old_letters_guessed.count(str(letter_guessed.lower())) == 0
    old_letters_guessed.sort()
    if (letters_list and letters_check and letter_count) == False:
        print("X ")  
        print(" -> ".join(old_letters_guessed)) 
        return False
    elif (letters_list and letter_count and letters_check) == True:
        old_letters_guessed.append(letter_guessed.lower())
        return True
    
def print_hangman(num_of_tries):
#    Prints hangman state, according to input nunmer.
#   :param: num_of_tries: define the state to be displayed
#   :type: int
    HANGMAN_PHOTOS = {
        1: 
        "x-------x",
        2:
        ("""
        x-------x
        |
        |
        |
        |
        |
        """),
        3:
        ("""
        x-------x
        |       |
        |       0
        |
        |
        |
        """),
        4:
        ("""
        x-------x
        |       |
        |       0
        |       |
        |
        |
        """),
        5:
        ("""
        x-------x  
        |       |  
        |       0  
        |      /|\ 
        |
        |
        """),
        6:
        ("""
        x-------x
        |       |
        |       0
        |      /|\ 
        |      /
        |
        """),
        7:
        ("""
        x-------x
        |       |
        |       0
        |      /|\ 
        |      / \ 
        |
        """)}
    
    print(HANGMAN_PHOTOS[num_of_tries])

def show_hidden_word(secret_word, old_letters_guessed):
#   Displays guessed letters in the secret word, and '_' for letters that were
#   not guessed yet
#   param: secret_word: the word to be guessed
#   param: old_lettes_guessed: the letters that were guessted (user's input)
#   type secret_word: list
#   type old_lettes_guessed: list
#   return: the updated list, with all guessed letters
#   rtype: list
    for x in secret_word:
        if x not in old_letters_guessed:
            secret_word = secret_word.replace(x, '_ ')
    print(secret_word)

def check_valid_input(letter_guessed, old_letters_guessed):
#    Checks the validation of user’s input, e.g one English letter, not entered before
#    
#    param letter_guessed: user’s input
#    param old_letters_guessed: previous inputs
#    type letter_guessed: string
#    type old_letters_guessed: list
#    return: True if input is valid, False if not.
#    rtype: boolean
	
    global secret_word
    letter_count = len(str(letter_guessed)) == 1
    letters_check = str(letter_guessed).isalpha()
    letters_list = old_letters_guessed.count(str(letter_guessed.lower())) <= 0
    return letter_count and letters_check and letters_list 

def start_screen():
#   Prints the start screen and get info from user about file path and the index of the word.
#   file_path: string
#   word_number: int
    print("""Welcome to the game Hangman 
     _    _
    | |  | |
    | |__| | __ _ _ __   __ _ _ __ ___   __ _ _ __
    |  __  |/ _' | '_ \ / _' | '_ ' _ \ / _' | '_ \   
    | |  | | (_| | | | | (_| | | | | | | (_| | | | |  
    |_|  |_|\__,_|_| |_|\__, |_| |_| |_|\__,_|_| |_|  
                         __/ |                        
                        |___/                         
    """)
    file_path = input("Write the name of the word bank(The file path(str)):")
    word_number = int(input("Write the index of the word(int):"))
    print("\nLet's start!\n")
    print_hangman(1)
    return file_path, word_number

def main():
    choose_word_parameters = start_screen()
    secret_word = choose_word(choose_word_parameters[0], choose_word_parameters[1])
    num_of_tries = 1
    old_letters_guessed = []
    print(len(secret_word) * ("_ "))
    while num_of_tries < 8:
        user_input = input("Guess a letter:")
        
        validation = check_valid_input(user_input, old_letters_guessed)
        if validation == False:
            try_update_letter_guessed(user_input, old_letters_guessed)
        elif user_input in secret_word:  
            old_letters_guessed.append(user_input.lower())
        else:
            num_of_tries += 1
            old_letters_guessed.append(user_input.lower())
            print(":(")
        show_hidden_word(secret_word, old_letters_guessed)
        print_hangman(num_of_tries)
        if num_of_tries == 7:
            print("You Lose")
            break
        if check_win(secret_word, old_letters_guessed) == True:
            print("You Win")
            break

if __name__ == "__main__":
    main()