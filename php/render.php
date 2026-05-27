<?php

declare(strict_types=1);

use Twig\Environment;

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

function applyAlterTwig(Environment $twig, array $config): void
{
    $alterTwigPath = __DIR__ . DIRECTORY_SEPARATOR . 'alter-twig.php';
    if (!is_file($alterTwigPath)) {
        return;
    }

    require_once $alterTwigPath;

    if (function_exists('addCustomExtension')) {
        addCustomExtension($twig, $config);
        return;
    }

    throw new RuntimeException('Found php/alter-twig.php but no addCustomExtension(Environment &$env, $config) function was defined.');
}

$options = parseArgs($argv);
$templatePath = $options['template'] ?? '';
$contextPath = $options['context'] ?? '';
$componentsRoot = $options['components-root'] ?? dirname($templatePath);

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
            applyAlterTwig($twig, [
                'template_path' => $templatePath,
                'components_root' => $componentsRoot,
                'context_path' => $contextPath,
                'context' => $context,
                'repo_root' => dirname(__DIR__),
            ]);
            $templateName = str_replace(DIRECTORY_SEPARATOR, '/', ltrim(str_replace($componentsRoot, '', $templatePath), DIRECTORY_SEPARATOR));
            echo $twig->render($templateName, $context);
            exit(0);
        } catch (Throwable $e) {
            fwrite(STDERR, 'Twig renderer error: ' . $e->getMessage() . PHP_EOL);
            exit(1);
        }
    }

    fwrite(STDERR, "Twig classes not available from Composer autoload; using fallback renderer\n");
}

echo fallbackRender($templatePath, $context, $componentsRoot);
