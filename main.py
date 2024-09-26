from bot.actions import register_actions
from bot.scheduler import setup_scheduler
from bot.users import load_users, save_users
from telegram.ext import Updater
from bot.config import TOKEN
import logging

# Настройка логирования
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')


if __name__ == '__main__':
    # Инициализация бота
    updater = Updater(token=TOKEN, use_context=True)
    dispatcher = updater.dispatcher

    # Загрузка пользователей
    users = load_users()
    # сохраняем пользователей в cntext.user_data
    dispatcher.user_data['users'] = users

    # Регистрация обработчиков
    register_actions(dispatcher, users)

    # Настройка планировщика
    setup_scheduler(updater.bot, users)

    # Запуск бота
    try:
        updater.start_polling()
        logging.info("Бот запущен и ожидает сообщений.")
        updater.idle()
    except Exception as e:
        logging.error(f"Ошибка при запуске бота: {e}")
    finally:
        save_users(users)


























# import requests
# from telegram.ext import Updater, CommandHandler, CallbackQueryHandler
# from telegram import InlineKeyboardButton, InlineKeyboardMarkup
# from apscheduler.schedulers.background import BackgroundScheduler
# import pytz
# import logging
# import pickle
# import os

# # Настройка логирования
# logging.basicConfig(level=logging.INFO)
#     # format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    


# # Загрузка переменных окружения
# # from dotenv import load_dotenv
# # load_dotenv()
# # TOKEN = os.getenv('TOKEN')

# TOKEN = '8174195453:AAEKTG_UHj2cRMZuiXwgqxL8hEi1PwHrNg8'  # Замените на токен вашего бота

# # Файл для хранения ID пользователей
# USERS_FILE = 'users.pkl'

# # Функция для загрузки списка пользователей из файла
# def load_users():
#     if os.path.exists(USERS_FILE):
#         try:
#             with open(USERS_FILE, 'rb') as f:
#                 users = pickle.load(f)
#             logging.info("Список пользователей успешно загружен.")
#             return users
#         except Exception as e:
#             logging.error(f"Ошибка при загрузке списка пользователей: {e}")
#             return set()
#     else:
#         return set()

# # Функция для сохранения списка пользователей в файл
# def save_users():
#     try:
#         with open(USERS_FILE, 'wb') as f:
#             pickle.dump(users, f)
#         logging.info("Список пользователей успешно сохранен.")
#     except Exception as e:
#         logging.error(f"Ошибка при сохранении списка пользователей: {e}")

# # Загрузка списка пользователей при запуске
# users = load_users()

# # Функция для получения данных о криптовалютах
# def get_crypto_prices():
#     try:
#         url = 'https://api.coingecko.com/api/v3/simple/price'
#         params = {
#             'ids': 'bitcoin,ethereum',
#             'vs_currencies': 'usd',
#             'include_24hr_change': 'true'
#         }
#         response = requests.get(url, params=params, timeout=10)
#         response.raise_for_status()
#         data = response.json()
#         return data
#     except requests.exceptions.RequestException as e:
#         logging.error(f"Ошибка при получении данных о криптовалютах: {e}")
#         return {}
    
#    # Функция для получения данных о криптовалютах
# def get_crypto_top():
#     try:
#         url = 'https://api.coingecko.com/api/v3/coins/markets'
#         params = {
#             'vs_currency': 'usd',        # Валюта для сравнения
#             'order': 'volume_desc',   # Сортировка по объему
#             'per_page': 30,               # Количество криптовалют
#             'page': 1,                    # Номер страницы
#             'sparkline': False,             # Исключить исторические данные
#             'price_change_percentage': '7d'
#         }
#         response = requests.get(url, params=params, timeout=10)
#         response.raise_for_status()
#         data = response.json()
#         return data
#     except requests.exceptions.RequestException as e:
#         logging.error(f"Ошибка при получении данных о криптовалютах: {e}")
#         return []

# # Функция для форматирования данных
# def format_crypto_data(data):
#     if not data:
#         return "Не удалось получить данные о криптовалютах."
#     try:
#         message = ''
#         for crypto in data:
#             price = data[crypto]['usd']
#             change = data[crypto].get('usd_24h_change', 0)
#             message += f"{crypto.capitalize()}:\nЦена: ${price}\nИзменение за 24ч: {change:.2f}%\n\n"
#         return message
#     except Exception as e:
#         logging.error(f"Ошибка при форматировании данных: {e}")
#         return "Ошибка при обработке данных о криптовалютах."

# # Функция для получения данных о конкретном токене
# def get_token_price(token_id):
#     try:
#         url = 'https://api.coingecko.com/api/v3/simple/price'
#         params = {
#             'ids': token_id,
#             'vs_currencies': 'usd',
#             'include_24hr_change': 'true'
#         }
#         response = requests.get(url, params=params, timeout=10)
#         response.raise_for_status()
#         data = response.json()
#         return data
#     except requests.exceptions.RequestException as e:
#         logging.error(f"Ошибка при получении данных о токене {token_id}: {e}")
#         return {}

# # Функция для форматирования данных токена
# def format_token_data(token_id, data):
#     if not data or token_id not in data:
#         return "Не удалось получить данные о выбранном токене."
#     try:
#         price = data[token_id]['usd']
#         change = data[token_id].get('usd_24h_change', 0)
#         message = f"{token_id.capitalize()}:\nЦена: ${price}\nИзменение за 24ч: {change:.2f}%\n"
#         return message
#     except Exception as e:
#         logging.error(f"Ошибка при форматировании данных о токене {token_id}: {e}")
#         return "Ошибка при обработке данных о токене."
    
# # Обработчик команды /start
# def start(update, context):
#     user = update.message.chat_id
#     if user not in users:
#         users.add(user)
#         save_users()
#         logging.info(f"Пользователь {user} подписался на обновления.")
#     else:
#         logging.info(f"Пользователь {user} уже подписан.")

#     # Создаём кнопку
#     keyboard = [
#         [InlineKeyboardButton("Получить текущую цену", callback_data='get_price')]
#     ]
#     reply_markup = InlineKeyboardMarkup(keyboard)

#     context.bot.send_message(chat_id=user,
#                              text="Вы подписаны на ежедневные обновления курсов криптовалют.",
#                              reply_markup=reply_markup)

# # Обработчик команды /stop
# def stop(update, context):
#     user = update.message.chat_id
#     if user in users:
#         users.remove(user)
#         save_users()
#         logging.info(f"Пользователь {user} отписался от обновлений.")
#         context.bot.send_message(chat_id=user, text="Вы отписались от ежедневных обновлений.")
#     else:
#         logging.info(f"Пользователь {user} не был подписан.")
#         context.bot.send_message(chat_id=user, text="Вы не были подписаны на обновления.")

# # Обработчик команды /help
# def help_command(update, context):
#     help_text = (
#         "/start - Подписаться на ежедневные обновления\n"
#         "/stop - Отписаться от обновлений\n"
#         "/price [token] - Получить текущую цену токена (например, /price ethereum)\n"
#         "/help - Показать это сообщение"
#     )
#     context.bot.send_message(chat_id=update.effective_chat.id, text=help_text)

# # Обработчик команды /price
# def price(update, context):
#     if context.args:
#         token_id = context.args[0].lower()
#     else:
#         context.bot.send_message(chat_id=update.effective_chat.id,
#                                  text="Пожалуйста, укажите токен. Пример использования: /price bitcoin")
#         return

#     data = get_token_price(token_id)
#     message = format_token_data(token_id, data)
#     context.bot.send_message(chat_id=update.effective_chat.id, text=message)

# def top(update, context):
#     try:
#         data = get_crypto_top()
#         if not data:
#             context.bot.send_message(chat_id=update.effective_chat.id, text="Не удалось получить данные.")
#             return

#         message = "Топ криптовалют:\n"
#         for i, coin in enumerate(data, start=1):
#             message += f"{i}. {coin['name']} ({coin['symbol'].upper()}): ${coin['current_price']} ({coin['price_change_percentage_24h']}% за 24ч)\n"

#         context.bot.send_message(chat_id=update.effective_chat.id, text=message)
#     except Exception as e:
#         logging.error(f"Ошибка в команде /top: {e}")
#         context.bot.send_message(chat_id=update.effective_chat.id, text="Произошла ошибка при выполнении команды.")

# # Обработчик нажатия кнопки
# def button(update, context):
#     query = update.callback_query
#     query.answer()

#     if query.data == 'get_price':
#         token_id = 'bitcoin'  # Токен по умолчанию
#         data = get_token_price(token_id)
#         message = format_token_data(token_id, data)
#         context.bot.send_message(chat_id=query.message.chat_id, text=message)

# # Функция для отправки ежедневных обновлений
# def send_daily_updates():
#     data = get_crypto_prices()
#     message = format_crypto_data(data)
#     for user in users:
#         try:
#             updater.bot.send_message(chat_id=user, text=message)
#             logging.info(f"Отправлено обновление пользователю {user}.")
#         except Exception as e:
#             logging.error(f"Ошибка при отправке сообщения пользователю {user}: {e}")

# if __name__ == '__main__':
#     # Инициализация бота
#     updater = Updater(token=TOKEN, use_context=True)
#     dispatcher = updater.dispatcher

#     # Добавление обработчиков команд
#     dispatcher.add_handler(CommandHandler('start', start))
#     dispatcher.add_handler(CommandHandler('stop', stop))
#     dispatcher.add_handler(CommandHandler('help', help_command))
#     dispatcher.add_handler(CommandHandler('price', price))
#     dispatcher.add_handler(CommandHandler('top', top))
#     dispatcher.add_handler(CallbackQueryHandler(button))

#     # Указание часового пояса
#     tz = pytz.timezone('Europe/Moscow')  # Замените на ваш часовой пояс

#     # Настройка планировщика с часовым поясом
#     scheduler = BackgroundScheduler(timezone=tz)
#     scheduler.add_job(send_daily_updates, 'cron', hour=9, minute=0)

#     # Запуск планировщика
#     scheduler.start()
#     logging.info("Планировщик запущен.")

#     # Запуск бота
#     try:
#         updater.start_polling()
#         logging.info("Бот запущен и ожидает сообщений.")
#         updater.idle()
#     except Exception as e:
#         logging.error(f"Ошибка при запуске бота: {e}")
#     finally:
#         # Сохранение списка пользователей при завершении работы
#         save_users()