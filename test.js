import { config } from 'dotenv'; // Импортируем dotenv
config(); // Загружаем переменные из .env
import { chromium } from 'playwright'; // Импортируем Playwright
import fs from 'fs'; // Импортируем fs
import https from 'https'; // Импортируем https
import fetch from 'node-fetch'; // Импортируем fetch
import { BetaAnalyticsDataClient } from '@google-analytics/data';

const landingBaseUrl = process.env.LANDING_URL; // Чтение URL из .env
const slackWebhookUrl = process.env.SLACK_WEBHOOK_URL;
// Глобальные переменные для хранения данных
let gaClientId, ymClientId, token;
// Функция для отправки уведомлений в Slack
async function sendSlackNotification(message) {
    const slackWebhookUrl = process.env.SLACK_WEBHOOK_URL; // URL вебхука из .env
    if (!slackWebhookUrl) {
        console.error('Ошибка: SLACK_WEBHOOK_URL не указан в .env файле');
        return;
    }

    const payload = {
        text: message,
    };

    try {
        const response = await fetch(slackWebhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            const errorBody = await response.text();
            console.error(`Ошибка при отправке уведомления в Slack: ${response.status} ${errorBody}`);
            throw new Error(`Ошибка при отправке уведомления в Slack: ${response.status} ${errorBody}`);
        }

        console.log(`Уведомление успешно отправлено в Slack: ${message}`);
    } catch (error) {
        console.error('Ошибка при отправке уведомления в Slack:', error.message);
    }
}

(async () => {
    console.log('Запуск автотеста...');
    const browser = await chromium.launch({ headless: false });

    // Настройка контекста браузера
    const context = await browser.newContext({
        bypassCSP: true, // Игнорирование Content Security Policy (CSP)
        ignoreHTTPSErrors: true, // Игнорирование ошибок HTTPS
    });

    const page = await context.newPage();

    // Функция для выполнения шага с логированием ошибок и остановкой теста при неудаче
    const checkStep = async (stepName, stepFunction) => {
        try {
            console.log(`Выполняем шаг: ${stepName}`);
            await sendSlackNotification(`Начало шага: ${stepName}`);
            await stepFunction();
            console.log(`Шаг успешно выполнен: ${stepName}`);
            await sendSlackNotification(`Шаг успешно выполнен: ${stepName}`);
        } catch (error) {
            console.error(`Ошибка на шаге "${stepName}":`, error.message);
            await sendSlackNotification(`Ошибка на шаге "${stepName}": ${error.message}`);
            process.exit(1); // Остановка выполнения теста
        }
    };

    // Функция для генерации пароля
    const generatePassword = () => {
        const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'; // Заглавные буквы
        const lowercase = 'abcdefghijklmnopqrstuvwxyz'; // Строчные буквы
        const digits = '0123456789'; // Цифры

        // Генерация одного символа каждого типа
        const randomUppercase = uppercase[Math.floor(Math.random() * uppercase.length)];
        const randomLowercase = lowercase[Math.floor(Math.random() * lowercase.length)];
        const randomDigit = digits[Math.floor(Math.random() * digits.length)];

        // Добавление случайных символов для дополнительной длины
        const allCharacters = uppercase + lowercase + digits;
        let additionalChars = '';
        for (let i = 0; i < 5; i++) { // Добавляем 5 случайных символов
            additionalChars += allCharacters[Math.floor(Math.random() * allCharacters.length)];
        }

        // Сборка пароля
        const password = randomUppercase + randomLowercase + randomDigit + additionalChars;

        // Перемешивание символов в пароле
        return password.split('').sort(() => Math.random() - 0.5).join('');
    };

    async function queryClickhouse(query) {
        const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args)); // Динамический импорт node-fetch
    
        try {
            const cert = fs.readFileSync(process.env.CLICKHOUSE_SSL_CERT); // Чтение SSL-сертификата
    
            const response = await fetch(`https://${process.env.CLICKHOUSE_HOST}:${process.env.CLICKHOUSE_PORT}/?database=${process.env.CLICKHOUSE_DATABASE}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Basic ${Buffer.from(`${process.env.CLICKHOUSE_USER}:${process.env.CLICKHOUSE_PASSWORD}`).toString('base64')}`,
                },
                body: query,
                agent: new https.Agent({
                    ca: cert, // Использование SSL-сертификата
                }),
            });
    
            if (!response.ok) {
                const errorBody = await response.text();
                console.error('Ошибка HTTP:', response.status, errorBody);
                throw new Error(`HTTP error: ${response.status} ${errorBody}`);
            }
    
            const responseBody = await response.text(); // Получаем текстовый ответ
    
            return responseBody; // Возвращаем текстовый ответ
        } catch (error) {
            console.error('Ошибка при выполнении запроса к ClickHouse:', error.message);
            throw error;
        }
    }

    try {
        // 1. Очистка кук и кеша
        await checkStep('Очистка кук и кеша', async () => {
            await context.clearCookies();
            await page.reload();
        });

        // 2. Открытие страницы нового лендинга с UTM-метками
        const testId = Math.random().toString(36).substring(7); // Генерация уникального test_id
        const landingUrl = `${landingBaseUrl}?utm_source=test-${testId}&utm_campaign=test-campaign-${testId}&utm_content=test-content-${testId}&utm_term=test-term-${testId}`;
        await checkStep('Открытие страницы лендинга', async () => {
            console.log(`Переход на страницу лендинга: ${landingUrl}`);
            // Переход на страницу с использованием domcontentloaded
            await page.goto(landingUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
            // Добавляем задержку для завершения инициализации
            console.log('Ожидание 2 секунды для завершения инициализации...');
            await page.waitForTimeout(2000);

            // Проверка инициализации Google Tag Manager
            const gtmInitialized = await page.evaluate(() => {
                return !!window.google_tag_manager && !!window.google_tag_manager['GTM-MMH44LDT'];
            });
            if (!gtmInitialized) {
                throw new Error('Google Tag Manager не инициализирован');
            }
            console.log('Google Tag Manager успешно инициализирован');

            // Проверка инициализации Google Analytics
            const gaInitialized = await page.evaluate(() => {
                return !!window.google_tag_manager && !!window.google_tag_manager['G-GX6CEHGXRD'];
            });
            if (!gaInitialized) {
                throw new Error('Google Analytics не инициализирован');
            }
            console.log('Google Analytics успешно инициализирован');

            // Проверка clientID от Google Analytics
            gaClientId = await page.evaluate(() => {
                return window.gaGlobal ? window.gaGlobal.vid : null;
            });
            if (!gaClientId) {
                throw new Error('ClientID для Google Analytics не установлен');
            }
            gaClientId =`GA1.1.${gaClientId}`;
            console.log(`ClientID для Google Analytics: ${gaClientId}`);
            // Проверка инициализации Яндекс Метрики
            const ymInitialized = await page.evaluate(() => {
                return !!window.yaCounter98674938;
            });
            if (!ymInitialized) {
                throw new Error('Яндекс Метрика не инициализирована');
            }
            console.log('Яндекс Метрика успешно инициализирована');

            // Проверка clientID от Яндекс Метрики
            ymClientId = await page.evaluate((counterId) => {
                return new Promise((resolve) => {
                    window[`yaCounter${counterId}`].getClientID((clientId) => resolve(clientId));
                });
            }, 98674938);
            if (!ymClientId) {
                throw new Error('ClientID для Яндекс Метрики не установлен');
            }
            console.log(`ClientID для Яндекс Метрики: ${ymClientId}`);

// Проверка отправки AJAX-запроса и получения токена
await checkStep('Проверка AJAX-запроса к send_clickhouse.php', async () => {
    console.log('Ожидание AJAX-запроса на send_clickhouse.php...');

    // Ожидание запроса к send_clickhouse.php
    const response = await page.waitForResponse(response =>
        response.url().includes('https://brokensun.com/local/utilites/send_clickhouse.php'),
        { timeout: 60000 }
    );

    if (!response.ok()) {
        const errorBody = await response.text();
        throw new Error(`Ошибка при запросе к send_clickhouse.php: ${response.status()} ${errorBody}`);
    }

    const responseBody = await response.text();
    console.log('Ответ от send_clickhouse.php получен.');

    // Извлечение токена из ответа с помощью регулярного выражения
    const tokenMatch = responseBody.match(/'([^']+)'/);
    if (!tokenMatch) {
        throw new Error('Токен не найден в ответе');
    }

    token = tokenMatch[1]; // Сохраняем токен

    // Логирование длины токена для отладки
    console.log(`Извлеченный токен: ${token}`);
    console.log(`Длина токена: ${token.length}`);

    // Проверка формата токена
    const tokenFormat = /^[a-zA-Z0-9]{28,32}$/; // Токен должен содержать от 28 до 32 символов
    if (!tokenFormat.test(token)) {
        throw new Error(`Неверный формат токена: ${token}. Длина: ${token.length}`);
    }

    console.log(`AJAX-запрос выполнен успешно. Токен: ${token}`);
});

            // Проверка видимости кнопкe "ИГРАТЬ"
            const playButtonSelector = 'button[onclick*="/auth/oauth2_basic/?signup=1"]';
            const playButton = await page.$(playButtonSelector);

            if (!playButton || !(await playButton.isVisible())) {
                throw new Error('Кнопка "ИГРАТЬ" не найдена или скрыта');
            }
        
            console.log('Клик по кнопкe "ИГРАТЬ"...');
            await page.click(playButtonSelector);
        });

        // 3. Заполнение формы регистрации
        const randomEmail = `testuser_${Math.random().toString(36).substring(7)}@example.com`;
        const randomPassword = generatePassword(); // Генерация пароля с учетом требований
        await checkStep('Заполнение формы регистрации', async () => {
            console.log(`Генерация уникальных данных для регистрации: Email - ${randomEmail}, Пароль - ${randomPassword}`);

            // Заполнение полей
            console.log('Заполнение поля "Электронная почта"...');
            await page.fill('#signup_email', randomEmail);

            console.log('Заполнение поля "Введите пароль"...');
            await page.fill('#signup_password', randomPassword);

            console.log('Заполнение поля "Введите пароль повторно"...');
            await page.fill('#signup_confirm', randomPassword);

            // Установка галочек в полях согласия
            console.log('Установка галочки "Принять условия использования"...');
            await page.check('#signup_agreement');

            console.log('Установка галочки "Я подтверждаю, что мне исполнилось 18 лет"...');
            await page.check('#signup_agreement-adult'); // Обновленный селектор

            // Клик по кнопкe "Регистрация"
            console.log('Клик по кнопкe "Регистрация"...');
            await page.click('button[type="submit"].signup-button');
        });

        // 4. Проверка перехода на страницу успешной регистрации
        await checkStep('Проверка перехода на страницу успешной регистрации', async () => {
            console.log('Ожидание перехода на страницу успешной регистрации...');
            await page.waitForURL('https://auth.brokensun.com/result/%20brokensun.com', { timeout: 60000 });

            // Клик по кнопкe "OK"
            console.log('Клик по кнопкe "OK"...');
            await page.click('button:has-text("OK")');
        });

        // Проверка данных сессии в Clickhouse
await checkStep('Проверка данных сессии в Clickhouse', async () => {
    console.log('Выполнение запроса в Clickhouse для проверки данных сессии...');

    // Добавляем задержку на случай, если данные еще не записались в ClickHouse
    console.log('Ожидание 5 секунд для записи данных в ClickHouse...');
    await page.waitForTimeout(5000);

    const query = `
        SELECT token, google_client_id, yandex_client_id, utm_params
        FROM event_data 
        WHERE token = '${token}' 
          AND yandex_client_id = '${ymClientId}'
          AND google_client_id = '${gaClientId}' 
    `;

    const clickhouseResponse = await queryClickhouse(query);
    console.log('Ответ от ClickHouse:', clickhouseResponse);

    // Проверяем, что ответ содержит данные
    if (!clickhouseResponse.includes(token) ||  
        !clickhouseResponse.includes(ymClientId)||
        !clickhouseResponse.includes(gaClientId)) {
        throw new Error('Данные сессии не найдены в Clickhouse');
    }
    // Проверка наличия события registration_success в Clickhouse
await checkStep('Проверка события registration_success в Clickhouse', async () => {
    console.log('Выполнение запроса в Clickhouse для проверки события registration_success...');

    const query = `
        SELECT token, event_name
        FROM event_data 
        WHERE token = '${token}'
          AND event_name = 'registration_success'
    `;

    const clickhouseResponse = await queryClickhouse(query);
    console.log('Ответ от ClickHouse:', clickhouseResponse);

    // Проверяем, что ответ содержит данные
    if (!clickhouseResponse.includes(token) || !clickhouseResponse.includes('registration_success')) {
        throw new Error('Событие registration_success не найдено в Clickhouse');
    }

    console.log('Событие registration_success успешно найдено в Clickhouse');
});

    console.log('Данные сессии успешно найдены в Clickhouse');
});
// Вызываем функцию для теста с таймаутом в 50 минут
await checkStep('Ожидание 50 минут перед отправкой запроса в Яндекс Метрику', async () => {
    console.log('Начинаем ожидание 50 минут...');
    
    for (let i = 1; i <= 50; i++) {
        const minutesText = getMinutesText(i);
        console.log(`Прошло ${i} ${minutesText}...`);
        await new Promise(resolve => setTimeout(resolve, 60000)); // Ждём
    }

    console.log('50 минут истекли, отправляем запрос в Яндекс Метрику.');
    await sendSlackNotification('50 минут истекли, отправляем запрос в Яндекс Метрику.');
});

// Функция для правильного склонения слова "минута"
function getMinutesText(minutes) {
    if (minutes % 10 === 1 && minutes % 100 !== 11) return 'минута';
    if ([2, 3, 4].includes(minutes % 10) && ![12, 13, 14].includes(minutes % 100)) return 'минуты';
    return 'минут';
}
//API запрос YM
const checkYandexMetricaGoal = async () => {
    try {
        console.log('Проверка достижения цели в Яндекс Метрике...');
        await sendSlackNotification('Проверка достижения цели в Яндекс Метрике...');

        // Чтение переменных окружения
        const counterId = process.env.YM_COUNTER_ID;
        const oauthToken = process.env.YM_OAUTH_TOKEN;

        if (!counterId || !oauthToken) {
            console.error('Ошибка: YM_COUNTER_ID или YM_OAUTH_TOKEN не указаны в .env файле');
            throw new Error('Необходимо указать YM_COUNTER_ID и YM_OAUTH_TOKEN в .env файле');
        }

        console.log(`Используемый OAuth-токен: ${oauthToken}`);
        console.log(`Используемый counterId: ${counterId}`);

        // Формирование URL запроса данных из Яндекс Метрики
        const params = new URLSearchParams();
        params.append('ids', counterId); // ID счетчика
        params.append('metrics', 'ym:s:visits'); // Метрика: количество визитов
        params.append('dimensions', 'ym:s:goal352610680IsReached'); // Группировка по достижению цели
        params.append('date1', '2daysAgo'); // Начальная дата (2 дней назад)
        params.append('date2', 'today'); // Конечная дата (сегодня)
        params.append('filters', `ym:s:clientID=='${ymClientId}'`); // Фильтр по clientID

        // Формируем URL
        const url = `https://api-metrika.yandex.net/stat/v1/data?${params}`;
        console.log('Отправка запроса к Яндекс Метрике:', url);
        await sendSlackNotification('Отправка запроса к Яндекс Метрике:', url);
        // Выполнение запроса к API
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `OAuth ${oauthToken}`,
            },
        });

        console.log('Статус ответа от Яндекс Метрики:', response.status);
        await sendSlackNotification('Статус ответа от Яндекс Метрики:', response.status);
        if (!response.ok) {
            const errorBody = await response.text();
            console.error(`Ошибка при получении данных из Яндекс Метрики: ${response.status} ${errorBody}`);
            await sendSlackNotification(`Ошибка при получении данных из Яндекс Метрики: ${response.status} ${errorBody}`);
            throw new Error(`Ошибка при получении данных из Яндекс Метрики: ${response.status} ${errorBody}`);
        }

        // Обрабатываем ответ
        const data = await response.json();
        console.log('Ответ от Яндекс Метрики:', JSON.stringify(data, null, 2));
        await sendSlackNotification('Ответ от Яндекс Метрики:', JSON.stringify(data, null, 2));

        if (!data.data || data.data.length === 0) {
            console.error(`Данные о достижении цели 'offline_registration_success' не найдены`);
            await sendSlackNotification(`Данные о достижении цели 'offline_registration_success' не найдены`);
            throw new Error(`Данные о достижении цели 'offline_registration_success' не найдены`);
        }

        console.log(`Данные о достижении цели 'offline_registration_success' для '${ymClientId}' успешно получены`);
        await sendSlackNotification(`Данные о достижении цели 'offline_registration_success' для '${ymClientId}' успешно получены`);
        if (data.data && data.data.length > 0) {
            const nameValue = data.data[0].dimensions[0].name;
            console.log(`Значение параметра "offline_registration_success": ${nameValue}`);
            await sendSlackNotification(`Значение параметра "offline_registration_success": ${nameValue}`);
          } else {
            console.error('Данные не найдены в ответе API');
            await sendSlackNotification('Данные не найдены в ответе API');
        }
    } catch (error) {
        console.error('Ошибка в процессе проверки достижения цели Яндекс Метрики:', error);
        await sendSlackNotification('Ошибка в процессе проверки достижения цели Яндекс Метрики:', error);
    }
};

// Вызываем функцию для теста
checkYandexMetricaGoal();

// //API запрос к GA
// // Получаем propertyId из .env
// const propertyId = process.env.GA4_PROPERTY_ID;

// // Определяем переменную для clientId (Google Tag ID), можно заменить на динамическое значение
// const clientId = 'GA1.1.671322060.1734445402'; // Жестко заданное значение для тестов

// async function runReportWithDimensionAndMetricFilters() {
//     // Инициализируем клиент для отправки запросов к Google Analytics Data API
//     const analyticsDataClient = new BetaAnalyticsDataClient();

//     // Выполняем отчет с фильтрацией по eventName (offline_registration_success)
//     // и activeUsers (Google Tag ID)
//     const [response] = await analyticsDataClient.runReport({
//         property: `properties/${propertyId}`,
//         dimensions: [
//             {
//                 name: 'eventName',
//             },
//         ],
//         metrics: [
//             {
//                 name: 'clientId',
//             },
//         ],
//         dateRanges: [
//             {
//                 startDate: 'yesterday',
//                 endDate: 'today',
//             },
//         ],
//         metricFilter: {
//             filter: {
//                 fieldName: 'clientId',
//                 stringFilter: {
//                     matchType: 'EXACT',
//                     value: clientId,
//                 },
//             },
//         },
//         dimensionFilter: {
//             filter: {
//                 fieldName: 'eventName',
//                 stringFilter: {
//                     matchType: 'EXACT',
//                     value: 'offline_registration_success',
//                 },
//             },
//         },
//     });
    
//     printRunReportResponse(response);
// }

// // Функция для вывода результатов отчета
// function printRunReportResponse(response) {
//     console.log(`${response.rowCount} строк получено`);
//     response.dimensionHeaders.forEach(dimensionHeader => {
//         console.log(`Заголовок измерения: ${dimensionHeader.name}`);
//     });
//     response.metricHeaders.forEach(metricHeader => {
//         console.log(`Заголовок метрики: ${metricHeader.name} (${metricHeader.type})`);
//     });

//     console.log('Результаты отчета:');
//     response.rows.forEach(row => {
//         console.log(`${row.dimensionValues[0].value}, ${row.metricValues[0].value}`);
//     });
// }

// // Запускаем отчет
// runReportWithDimensionAndMetricFilters().catch(err => {
//     console.error(`Ошибка: ${err.message}`);
//     process.exitCode = 1;
// });

    
    } finally {
        // Закрытие браузера
        console.log('Закрытие браузера...');
        await browser.close();
        console.log('Браузер успешно закрыт.');
    }
})();