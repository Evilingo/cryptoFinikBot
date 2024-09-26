import requests
import logging

def get_crypto_prices():
    url = 'https://api.coingecko.com/api/v3/simple/price'
    params = {'ids': 'bitcoin,ethereum', 'vs_currencies': 'usd', 'include_24hr_change': 'true'}
    try:
        response = requests.get(url, params=params, timeout=10)
        response.raise_for_status()
        return response.json()
    except requests.exceptions.RequestException as e:
        logging.error(f"Ошибка при получении данных о криптовалютах: {e}")
        return {}

def get_token_price(token_id):
    url = 'https://api.coingecko.com/api/v3/simple/price'
    params = {'ids': token_id, 'vs_currencies': 'usd', 'include_24hr_change': 'true'}
    try:
        response = requests.get(url, params=params, timeout=10)
        response.raise_for_status()
        return response.json()
    except requests.exceptions.RequestException as e:
        logging.error(f"Ошибка при получении данных о токене {token_id}: {e}")
        return {}

def get_crypto_top():
    url = 'https://api.coingecko.com/api/v3/coins/markets'
    params = {'vs_currency': 'usd', 'order': 'volume_desc', 'per_page': 30, 'page': 1, 'sparkline': False}
    try:
        response = requests.get(url, params=params, timeout=10)
        response.raise_for_status()
        return response.json()
    except requests.exceptions.RequestException as e:
        logging.error(f"Ошибка при получении топа криптовалют: {e}")
        return []

def format_token_data(token_id, data):
    if not data or token_id not in data:
        return "Не удалось получить данные, проверьте название токена "
    price = data[token_id]['usd']
    change = data[token_id].get('usd_24h_change', 0)
    return f"{token_id.capitalize()}:\nЦена: ${price}\nИзменение за 24ч: {change:.2f}%"