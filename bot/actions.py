from telegram import InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import CommandHandler, CallbackQueryHandler
from bot.handlers import get_token_price, format_token_data, get_crypto_top
from bot.users import save_users
import logging

logging.basicConfig(level=logging.INFO)


# def start(update, context):
#     user = update.message.chat_id
    
#     if 'users' not in context.user_data:
#         context.user_data['users'] = set()

#     users = context.user_data['users']

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

#     try:
#         context.bot.send_message(chat_id=user,
#                                 text="Вы подписаны на ежедневные обновления курсов криптовалют.",
#                                 reply_markup=reply_markup)
#         logging.info("Сообщение успешно отправлено")
#     except Exception as e:
#         logging.error(f"Ошибка при отправке сообщения: {e}")
def start(update, context):
    user = update.message.chat_id

    # Инициализация user_data для хранения пользователей
    if 'users' not in context.user_data:
        context.user_data['users'] = set()  # Инициализируем как множество, чтобы избежать дубликатов

    users = context.user_data['users']

    # Логирование для диагностики
    logging.info(f"Получен запрос от пользователя: {user}")

    if user not in users:
        users.add(user)
        save_users(users)  # Обязательно передайте users в функцию save_users
        logging.info(f"Пользователь {user} подписался на обновления.")
    else:
        logging.info(f"Пользователь {user} уже подписан.")

    # Создаём кнопку
    keyboard = [
        [InlineKeyboardButton("Получить текущую цену", callback_data='get_price')]
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)

    # Отправляем сообщение с клавиатурой
    try:
        context.bot.send_message(chat_id=user,
                                 text="Вы подписаны на ежедневные обновления курсов криптовалют.",
                                 reply_markup=reply_markup)
        logging.info(f"Сообщение с кнопкой успешно отправлено пользователю {user}")
    except Exception as e:
        logging.error(f"Ошибка при отправке сообщения: {e}")

def button(update, context):
    query = update.callback_query
    query.answer()

    if query.data == 'get_price':
        token_id = 'bitcoin'  # Токен по умолчанию
        data = get_token_price(token_id)
        message = format_token_data(token_id, data)
        context.bot.send_message(chat_id=query.message.chat_id, text=message)
    
def stop(update, context):
    user = update.message.chat_id
    # инициализация user_data
    if 'users' not in context.user_data:
        context.user_data['users'] = set()

    users = context.user_data['users']

    if user in users:
        users.remove(user)
        save_users(users)
        context.bot.send_message(chat_id=user, text="Вы отписались от ежедневных обновлений.")
        logging.info(f"Пользователь {user} отписался от обновлений.")
    else:
        context.bot.send_message(chat_id=user, text="Вы не были подписаны.")
        logging.info(f"Пользователь {user} попытался отписаться, но не был подписан.")

def price(update, context):
    if context.args:
        token_id = context.args[0].lower()
    else:
        context.bot.send_message(chat_id=update.effective_chat.id,
                                 text="Пожалуйста, укажите токен. Пример использования: /price bitcoin")
        return

    data = get_token_price(token_id)
    message = format_token_data(token_id, data)
    context.bot.send_message(chat_id=update.effective_chat.id, text=message)

def top(update, context):
    data = get_crypto_top()
    message = "Топ криптовалют:\n" + "\n".join(
        [f"{i+1}. {coin['name']} ({coin['symbol'].upper()}): ${coin['current_price']}" for i, coin in enumerate(data)]
    )
    context.bot.send_message(chat_id=update.effective_chat.id, text=message)


def help_command(update, context):
    try:
        help_text = (
            "/start - Подписаться на обновления\n"
            "/price [token]- Получить текущую цену токена (Например /price ethereum)\n"
            "/top - Получить топ 30 текущих монет по объему торгов за 24 часа\n"
            "/stop - Отписаться от обновлений\n"
            "/help - Помощь\n"
        )
        context.bot.send_message(chat_id=update.message.chat_id, text=help_text)
    except Exception as e:
        logging.error(f"Ошибка при обработке команды /help: {e}")

def register_actions(dispatcher, users):
    dispatcher.add_handler(CommandHandler('start', start))
    dispatcher.add_handler(CommandHandler('stop', stop))
    dispatcher.add_handler(CommandHandler('price', price))
    dispatcher.add_handler(CommandHandler('top', top))
    dispatcher.add_handler(CommandHandler('help', help_command))
    dispatcher.add_handler(CallbackQueryHandler(button))
    