<?php

declare(strict_types=1);

use Twig\Environment;
use Twig\Error\Error as TwigError;

error_reporting(E_ALL);
ini_set('display_errors', 'stderr');
ini_set('log_errors', '1');

function parseArgs(array $argv): array
{
    $out = [];
    for ($i = 1; $i < count($argv); $i++) {
        if (!str_starts_with($argv[$i], '--')) {
            continue;
        }

        $key = substr($argv[$i], 2);
        $value = $argv[$i + 1] ?? '';
        if ($value !== '' && !str_starts_with($value, '--')) {
            $out[$key] = $value;
            $i++;
        } else {
            $out[$key] = true;
        }
    }

    return $out;
}

function readContext(string $path): array
{
    if ($path === '' || !is_file($path)) {
        return [];
    }

    $decoded = json_decode((string) file_get_contents($path), true);
    if (!is_array($decoded)) {
        return [];
    }

    return $decoded;
}

function resolveValue(array $context, string $key): string
{
    $parts = explode('.', trim($key));
    $cursor = $context;

    foreach ($parts as $part) {
        if (!is_array($cursor) || !array_key_exists($part, $cursor)) {
            return '';
        }
        $cursor = $cursor[$part];
    }

    if (is_scalar($cursor)) {
        return (string) $cursor;
    }

    return '';
}

function resolveIncludePath(string $includePath, string $currentFile, string $componentsRoot): string
{
    if (str_starts_with($includePath, './') || str_starts_with($includePath, '../')) {
        return realpath(dirname($currentFile) . DIRECTORY_SEPARATOR . $includePath) ?: '';
    }

    return realpath($componentsRoot . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $includePath)) ?: '';
}

function fallbackRender(string $templatePath, array $context, string $componentsRoot, array &$stack = []): string
{
    $realPath = realpath($templatePath) ?: '';
    if ($realPath === '' || in_array($realPath, $stack, true)) {
        return '';
    }

    $stack[] = $realPath;
    $template = (string) file_get_contents($realPath);

    $template = preg_replace_callback('/\{\%\s*include\s+["\']([^"\']+)["\']\s*\%\}/', function ($matches) use ($realPath, $context, $componentsRoot, &$stack) {
        $resolved = resolveIncludePath($matches[1], $realPath, $componentsRoot);
        if ($resolved === '') {
            return '';
        }
        return fallbackRender($resolved, $context, $componentsRoot, $stack);
    }, $template) ?? $template;

    $template = preg_replace_callback('/\{\{\s*([a-zA-Z0-9_\.]+)\s*\}\}/', function ($matches) use ($context) {
        return htmlspecialchars(resolveValue($context, $matches[1]), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }, $template) ?? $template;

    array_pop($stack);
    return $template;
}

function applyAlterTwig(Environment $twig, array $config, string $alterTwigPath = ''): void
{
    if ($alterTwigPath === '') {
        return;
    }

    if (!is_file($alterTwigPath)) {
        throw new RuntimeException(sprintf('Configured Twig alter file was not found: %s', $alterTwigPath));
    }

    require_once $alterTwigPath;

    if (function_exists('addCustomExtension')) {
        addCustomExtension($twig, $config);
        return;
    }

    throw new RuntimeException(sprintf('Configured alter file did not define addCustomExtension(Environment &$env, $config): %s', $alterTwigPath));
}

function formatThrowable(Throwable $e): string
{
    $parts = [];
    $parts[] = sprintf('%s: %s', get_class($e), $e->getMessage());

    if ($e instanceof TwigError) {
        $templateFile = method_exists($e, 'getSourceContext') && $e->getSourceContext() !== null
            ? $e->getSourceContext()->getPath()
            : '';
        $templateLine = method_exists($e, 'getTemplateLine') ? $e->getTemplateLine() : 0;
        if ($templateFile !== '') {
            $parts[] = sprintf('Template: %s%s', $templateFile, $templateLine > 0 ? ':' . $templateLine : '');
        } elseif ($templateLine > 0) {
            $parts[] = sprintf('Template line: %d', $templateLine);
        }
    }

    $parts[] = sprintf('Origin: %s:%d', $e->getFile(), $e->getLine());
    $trace = $e->getTraceAsString();
    if ($trace !== '') {
        $parts[] = 'Trace:';
        $parts[] = $trace;
    }

    return implode(PHP_EOL, $parts);
}

function applyTwigSetup(Environment &$env, $config) {
    $repoRoot = is_string($config['repo_root'] ?? null) ? $config['repo_root'] : dirname(__DIR__);
    $srcRoot = is_string($config['src_root'] ?? null) ? $config['src_root'] : ($repoRoot . DIRECTORY_SEPARATOR . 'src');
    $assetsRoot = is_string($config['assets_root'] ?? null) ? $config['assets_root'] : ($srcRoot . DIRECTORY_SEPARATOR . 'assets');
    $dataRoot = is_string($config['data_root'] ?? null) ? $config['data_root'] : ($srcRoot . DIRECTORY_SEPARATOR . 'data');
    $componentsDir = is_string($config['components_root'] ?? null) ? $config['components_root'] : ($srcRoot . DIRECTORY_SEPARATOR . 'components');

    $repoRoot = realpath($repoRoot) ?: $repoRoot;
    $srcRoot = realpath($srcRoot) ?: $srcRoot;
    $assetsRoot = realpath($assetsRoot) ?: $assetsRoot;
    $dataRoot = realpath($dataRoot) ?: $dataRoot;
    $componentsDir = realpath($componentsDir) ?: $componentsDir;

  // Add folders to Twig loader paths
    if (is_dir($srcRoot)) {
        $env->getLoader()->addPath($srcRoot);
    }
    if (is_dir($assetsRoot)) {
        $env->getLoader()->addPath($assetsRoot);
    }
  
  // Register namespaces for each top level folder in components, so they can be used in templates like this: `{% include '@atoms/button.twig' %}`
  if (is_dir($componentsDir)) {
    $folders = scandir($componentsDir);
    foreach ($folders as $folder) {
      if ($folder === "." || $folder === "..") {
        continue;
      }
            $folderPath = $componentsDir . DIRECTORY_SEPARATOR . $folder;
            if (!is_dir($folderPath)) {
        continue;
      }
            $env->getLoader()->addPath($folderPath, $folder);
    }
  }

  $env->addExtension(new \Twig\Extension\DebugExtension());

  // Make all data files available as global variables in Twig, with the filename (without extension) as the variable name
    if (is_dir($dataRoot)) {
        $files = scandir($dataRoot);
    foreach ($files as $file) {
      if ($file === "." || $file === "..") {
        continue;
      }
            $filePath = $dataRoot . DIRECTORY_SEPARATOR . $file;
      if (is_file($filePath) && pathinfo($filePath, PATHINFO_EXTENSION) === 'json') {
        $variableName = pathinfo($filePath, PATHINFO_FILENAME);
                $decoded = json_decode((string) file_get_contents($filePath), true);
                if (is_array($decoded)) {
                        $env->addGlobal($variableName, $decoded);
                }
      }
    }
  }

}

$options = parseArgs($argv);
$templatePath = $options['template'] ?? '';
$contextPath = $options['context'] ?? '';
$componentsRoot = $options['components-root'] ?? dirname($templatePath);
$alterTwigPath = $options['alter-twig'] ?? '';
$repoRoot = $options['repo-root'] ?? dirname(__DIR__);
$srcRoot = $options['src-root'] ?? ($repoRoot . DIRECTORY_SEPARATOR . 'src');
$assetsRoot = $options['assets-root'] ?? ($srcRoot . DIRECTORY_SEPARATOR . 'assets');
$dataRoot = $options['data-root'] ?? ($srcRoot . DIRECTORY_SEPARATOR . 'data');

if ($templatePath === '' || !is_file($templatePath)) {
    fwrite(STDERR, "Template not found\n");
    exit(1);
}

$context = readContext($contextPath);
$composerAutoload = __DIR__ . DIRECTORY_SEPARATOR . 'vendor' . DIRECTORY_SEPARATOR . 'autoload.php';

if (is_file($composerAutoload)) {
    require_once $composerAutoload;

    if (class_exists('Twig\\Loader\\FilesystemLoader') && class_exists('Twig\\Environment')) {
        try {
            $loader = new Twig\Loader\FilesystemLoader($componentsRoot);
            // Pattern data often includes trusted HTML/SVG snippets that should render as markup.
            $twig = new Twig\Environment($loader, ['cache' => false, 'autoescape' => false]);
            $twigConfig = [
                'template_path' => $templatePath,
                'components_root' => $componentsRoot,
                'context_path' => $contextPath,
                'context' => $context,
                'repo_root' => $repoRoot,
                'src_root' => $srcRoot,
                'assets_root' => $assetsRoot,
                'data_root' => $dataRoot,
            ];
            applyTwigSetup($twig, $twigConfig);
            applyAlterTwig($twig, $twigConfig, $alterTwigPath);
            $templateName = str_replace(DIRECTORY_SEPARATOR, '/', ltrim(str_replace($componentsRoot, '', $templatePath), DIRECTORY_SEPARATOR));
            echo $twig->render($templateName, $context);
            exit(0);
        } catch (Throwable $e) {
            fwrite(STDERR, 'Twig renderer error' . PHP_EOL . formatThrowable($e) . PHP_EOL);
            exit(1);
        }
    }

    fwrite(STDERR, "Twig classes not available from Composer autoload; using fallback renderer\n");
}

echo fallbackRender($templatePath, $context, $componentsRoot);
