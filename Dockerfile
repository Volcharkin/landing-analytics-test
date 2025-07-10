# Этап 1: Используем образ с Node.js 20.10.0 для установки зависимостей
FROM node:20.10.0 AS build

# Устанавливаем рабочую директорию
WORKDIR /app

# Установка системных зависимостей для Playwright через apt-get
RUN apt-get update && apt-get install -y \
    libnss3 \
    libnspr4 \
    libdbus-1-3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libatspi2.0-0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libxkbcommon0 \
    libasound2 \
    --no-install-recommends \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Копируем package.json и yarn.lock в контейнер
COPY package.json yarn.lock ./

# Устанавливаем зависимости через Yarn
RUN yarn install

# Копируем все файлы проекта в контейнер
COPY . .

# Этап 2: Используем тот же образ для запуска тестов
FROM node:20.10.0

# Устанавливаем рабочую директорию
WORKDIR /app

# Копируем все файлы из первого этапа сборки
COPY --from=build /app /app

# Убедитесь, что Playwright установлен и зависимости для браузеров установлены
RUN yarn playwright install && yarn playwright install-deps

# Запускаем тесты через команду start
CMD ["yarn", "start"]