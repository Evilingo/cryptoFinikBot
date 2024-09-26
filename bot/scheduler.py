from apscheduler.schedulers.background import BackgroundScheduler
import pytz
import logging
from bot.handlers import get_crypto_prices, format_token_data

def send_daily_updates(bot, users):
    data = get_crypto_prices()
    message = format_token_data('bitcoin', data)
    for user in users:
        try:
            bot.send_message(chat_id=user, text=message)
        except Exception as e:
            logging.error(f"Ошибка при отправке пользователю {user}: {e}")

def setup_scheduler(bot, users):
    scheduler = BackgroundScheduler(timezone=pytz.timezone('Europe/Moscow'))
    scheduler.add_job(lambda: send_daily_updates(bot, users), 'cron', hour=9)
    scheduler.start()