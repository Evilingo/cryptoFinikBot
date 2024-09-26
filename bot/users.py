import pickle
import os
import logging

USERS_FILE = 'users.pkl'

def load_users():
    if os.path.exists(USERS_FILE):
        try:
            with open(USERS_FILE, 'rb') as f:
                return pickle.load(f)
        except Exception as e:
            logging.error(f"Ошибка при загрузке пользователей: {e}")
            return set()
    return set()

def save_users(users):
    try:
        with open(USERS_FILE, 'wb') as f:
            pickle.dump(users, f)
        logging.info("Список пользователей сохранен.")
    except Exception as e:
        logging.error(f"Ошибка при сохранении пользователей: {e}")