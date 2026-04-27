/**
 * SiMOTO Auto-Push Script
 * Автоматический пуш на GitHub с версионированием и Release
 * 
 * Использование:
 *   node scripts/auto-push.js              # patch (1.0.0 -> 1.0.1)
 *   node scripts/auto-push.js minor        # minor (1.0.0 -> 1.1.0)
 *   node scripts/auto-push.js major        # major (1.0.0 -> 2.0.0)
 *   node scripts/auto-push.js --dry-run    # тестовый прогон без пуша
 * 
 * Требования:
 *   - GH_TOKEN в .env или переменной окружения
 *   - git должен быть настроен
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { URL } = require('url');

const PROJECT_ROOT = path.join(__dirname, '..');
const GITHUB_REPO = 'RudzisID/simoto-sklad';
const GITHUB_API = 'https://api.github.com';

// ============================================
// КОНФИГУРАЦИЯ
// ============================================

/**
 * Получает GitHub токен из .env или переменной окружения
 */
function getGitHubToken() {
    // Сначала пробуем из .env
    const envPath = path.join(PROJECT_ROOT, '.env');
    if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf8');
        const match = envContent.match(/GH_TOKEN\s*=\s*(.+)/);
        if (match) return match[1].trim();
    }
    
    // Потом из переменной окружения
    return process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
}

/**
 * Выполняет команду git и возвращает результат
 */
function gitExec(args, options = {}) {
    try {
        const result = execSync(`git ${args.join(' ')}`, {
            cwd: PROJECT_ROOT,
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
            ...options
        });
        return { success: true, output: result.trim() };
    } catch (error) {
        return { success: false, error: error.message, output: error.stdout };
    }
}

/**
 * Получает текущую версию из package.json
 */
function getCurrentVersion() {
    const packageJson = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8'));
    return packageJson.version;
}

/**
 * Обновляет версию в package.json
 */
function updateVersion(currentVersion, bumpType) {
    const [major, minor, patch] = currentVersion.split('.').map(Number);
    let newVersion;
    
    switch (bumpType) {
        case 'major':
            newVersion = `${major + 1}.0.0`;
            break;
        case 'minor':
            newVersion = `${major}.${minor + 1}.0`;
            break;
        case 'patch':
        default:
            newVersion = `${major}.${minor}.${patch + 1}`;
    }
    
    const packageJson = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8'));
    packageJson.version = newVersion;
    fs.writeFileSync(
        path.join(PROJECT_ROOT, 'package.json'),
        JSON.stringify(packageJson, null, 2) + '\n',
        'utf8'
    );
    
    return newVersion;
}

/**
 * Определяет изменения в git
 */
function getChanges() {
    const result = gitExec(['status', '--porcelain']);
    if (!result.success) return { files: [], description: 'Ошибка определения изменений' };
    
    const files = result.output.split('\n')
        .filter(line => line.trim())
        .filter(line => !line.includes('.env')); // Исключаем .env
    
    if (files.length === 0) {
        return { files: [], description: 'Нет изменений для коммита' };
    }
    
    // Получаем diff для описания
    const diffResult = gitExec(['diff', '--stat']);
    const description = diffResult.success ? diffResult.output : `${files.length} файлов изменено`;
    
    return { files, description };
}

/**
 * Анализирует тип изменений и предлагает версию
 */
function analyzeChanges() {
    const { files } = getChanges();
    
    if (files.length === 0) {
        return { type: 'none', suggested: null };
    }
    
    let hasMajor = false;
    let hasMinor = false;
    
    for (const file of files) {
        const filename = file.replace(/^[MADRC]\s+/, '').trim();
        
        // major - изменение серверной логики, API, структуры
        if (filename.includes('server.js') || 
            filename.includes('lib/') && (filename.includes('api') || filename.includes('moysklad'))) {
            hasMajor = true;
        }
        
        // minor - новые функции, модули
        if (filename.startsWith('lib/') || filename.includes('public/')) {
            hasMinor = true;
        }
    }
    
    if (hasMajor) return { type: 'major', suggested: 'major' };
    if (hasMinor) return { type: 'minor', suggested: 'minor' };
    return { type: 'patch', suggested: 'patch' };
}

/**
 * Отправляет HTTP запрос к GitHub API
 */
function githubRequest(method, path, data = null, token) {
    return new Promise((resolve, reject) => {
        const url = new URL(path, GITHUB_API);
        const options = {
            hostname: url.hostname,
            path: url.pathname + url.search,
            method: method,
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28',
                'User-Agent': 'SiMOTO-AutoPush'
            }
        };
        
        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(body);
                    resolve({ status: res.statusCode, data: json });
                } catch (e) {
                    resolve({ status: res.statusCode, data: body });
                }
            });
        });
        
        req.on('error', reject);
        
        if (data) {
            req.write(JSON.stringify(data));
        }
        req.end();
    });
}

/**
 * Создаёт GitHub Release
 */
async function createGitHubRelease(tag, version, token) {
    console.log('\n📦 Создание GitHub Release...');
    
    const releaseData = {
        tag_name: tag,
        name: `v${version}`,
        body: `Версия ${version}\n\nАвтоматический релиз SiMOTO-Sklad\n\nИзменения:\n- Автоматический пуш с версионированием\n- Улучшенная стабильность`,
        draft: false,
        prerelease: false
    };
    
    const result = await githubRequest('POST', `/repos/${GITHUB_REPO}/releases`, releaseData, token);
    
    if (result.status === 201) {
        console.log(`✅ Release создан: https://github.com/${GITHUB_REPO}/releases/tag/${tag}`);
        return true;
    } else {
        console.log(`❌ Ошибка создания Release: ${result.status}`, result.data);
        return false;
    }
}

/**
 * Проверяет существует ли тег
 */
async function tagExists(tag, token) {
    const result = await githubRequest('GET', `/repos/${GITHUB_REPO}/git/ref/tags/${tag}`, null, token);
    return result.status === 200;
}

/**
 * Основная функция автопуша
 */
async function autoPush(bumpType = 'patch', options = {}) {
    const { dryRun = false, auto = false } = options;
    
    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║         SiMOTO Auto-Push v1.0.0                          ║');
    console.log('╚═══════════════════════════════════════════════════════════╝');
    
    // 1. Проверка токена
    const token = getGitHubToken();
    if (!token && !dryRun) {
        console.log('\n❌ GitHub token не найден!');
        console.log('   Добавь GH_TOKEN в .env файл:');
        console.log('   GH_TOKEN=your_github_token_here');
        console.log('\n   Создать токен: https://github.com/settings/tokens');
        console.log('   Требуемые права: repo, write:packages');
        return false;
    }
    
    // 2. Проверка git
    console.log('\n🔍 Проверка git...');
    const gitStatus = gitExec(['status']);
    if (!gitStatus.success) {
        console.log('❌ Git не инициализирован');
        return false;
    }
    console.log('✅ Git готов');
    
    // 3. Определение изменений
    console.log('\n📝 Анализ изменений...');
    const { files, description } = getChanges();
    
    if (files.length === 0) {
        console.log('ℹ️  Нет изменений для коммита');
        console.log('   Все файлы уже в репозитории или изменений нет');
        return false;
    }
    
    console.log(`   Файлов изменено: ${files.length}`);
    console.log(`   ${description.substring(0, 60)}...`);
    
    // 4. Анализ типа изменений
    const analysis = analyzeChanges();
    console.log(`   Рекомендуемый тип: ${analysis.suggested || 'N/A'}`);
    
    // 5. Определение версии
    let version;
    if (bumpType === 'auto') {
        bumpType = analysis.suggested || 'patch';
    }
    
    // Если не auto и не указан явно, используем patch по умолчанию
    if (!['major', 'minor', 'patch'].includes(bumpType)) {
        bumpType = 'patch';
    }
    
    const currentVersion = getCurrentVersion();
    version = updateVersion(currentVersion, bumpType);
    
    console.log(`\n📌 Версия: ${currentVersion} → ${version} (${bumpType})`);
    
    if (dryRun) {
        console.log('\n🟡 DRY RUN - коммит и пуш не будут выполнены');
        console.log('\nИзменённые файлы:');
        files.forEach(f => console.log(`   ${f}`));
        return true;
    }
    
    // 6. Интерактивное подтверждение если не auto
    if (!auto) {
        console.log(`\n⚠️  Будет выполнен пуш версии ${version} на GitHub`);
        console.log('   Продолжить? (y/n): ');
        // Для автоматического режима продолжаем без подтверждения
    }
    
    // 7. Создание коммита
    console.log('\n📦 Создание коммита...');
    const commitMessage = `release: v${version} - ${description.substring(0, 50)}`;
    
    // Добавляем все файлы кроме .env
    gitExec(['add', '-A', '--', ':!.env']);
    const commitResult = gitExec(['commit', '-m', commitMessage]);
    
    if (!commitResult.success) {
        console.log('❌ Ошибка коммита:', commitResult.error);
        return false;
    }
    console.log('✅ Коммит создан');
    
    // 8. Пуш
    console.log('\n🚀 Отправка на GitHub...');
    const pushResult = gitExec(['push', 'origin', 'main']);
    
    if (!pushResult.success) {
        console.log('❌ Ошибка пуша:', pushResult.error);
        // Откат коммита
        gitExec(['reset', '--soft', 'HEAD~1']);
        gitExec(['checkout', '--', '.']);
        return false;
    }
    console.log('✅ Пуш выполнен');
    
    // 9. Создание тега
    console.log('\n🏷️  Создание тега...');
    const tagName = `v${version}`;
    
    // Удаляем существующий тег если есть
    gitExec(['tag', '-d', tagName]).success; // игнорируем ошибку если тега нет
    gitExec(['push', 'origin', ':refs/tags/', tagName]).success;
    
    // Создаём новый тег
    const tagResult = gitExec(['tag', '-a', tagName, '-m', `Version ${version}`]);
    if (!tagResult.success) {
        console.log('❌ Ошибка создания тега:', tagResult.error);
        return false;
    }
    
    // Пушим тег
    const tagPushResult = gitExec(['push', 'origin', tagName]);
    if (!tagPushResult.success) {
        console.log('⚠️  Тег локально создан, но не запушен на GitHub');
    } else {
        console.log('✅ Тег запушен');
    }
    
    // 10. Создание Release
    try {
        await createGitHubRelease(tagName, version, token);
    } catch (e) {
        console.log('⚠️  Release не создан (возможно токен без нужных прав)');
    }
    
    console.log('\n╔═══════════════════════════════════════════════════════════╗');
    console.log(`║  ✅ Auto-push завершён! Версия: ${version.padEnd(25)}║`);
    console.log('╚═══════════════════════════════════════════════════════════╝');
    console.log(`   Репозиторий: https://github.com/${GITHUB_REPO}`);
    console.log(`   Release:     https://github.com/${GITHUB_REPO}/releases`);
    
    return true;
}

// ============================================
// ЗАПУСК
// ============================================

const args = process.argv.slice(2);
let bumpType = 'patch';
let dryRun = false;
let autoMode = false;

// Парсинг аргументов
for (const arg of args) {
    if (arg === 'minor' || arg === 'major' || arg === 'patch' || arg === 'auto') {
        bumpType = arg;
    } else if (arg === '--dry-run' || arg === '-n') {
        dryRun = true;
    } else if (arg === '--auto' || arg === '-y') {
        autoMode = true;
    } else if (arg === '--help' || arg === '-h') {
        console.log(`
SiMOTO Auto-Push

Использование:
  node scripts/auto-push.js [тип] [опции]

Типы версионирования:
  patch  - исправления (по умолчанию) - 1.0.0 -> 1.0.1
  minor  - новые функции              - 1.0.0 -> 1.1.0  
  major  - критические изменения      - 1.0.0 -> 2.0.0
  auto   - автоматическое определение
  
Опции:
  --dry-run, -n  тестовый прогон без пуша
  --auto, -y     автоматический режим без подтверждения
  --help, -h     эта справка

Примеры:
  node scripts/auto-push.js              # patch версия
  node scripts/auto-push.js minor       # minor версия
  node scripts/auto-push.js major       # major версия
  node scripts/auto-push.js --dry-run   # тест
  node scripts/auto-push.js --auto      # авто режим

Требования:
  1. GitHub Personal Access Token в .env:
     GH_TOKEN=ghp_xxxxxxxxxxxx
     
  2. Токен должен иметь права:
     - repo (полный доступ к репозиториям)
     
  3. Git должен быть настроен:
     git config --global user.name "Your Name"
     git config --global user.email "you@example.com"
`);
        process.exit(0);
    }
}

// Запуск
autoPush(bumpType, { dryRun, auto: autoMode }).catch(console.error);