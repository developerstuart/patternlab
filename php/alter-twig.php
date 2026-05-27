<?php

use Twig\Environment;
use Twig\TwigFunction;
use Twig\TwigFilter;

/**
 * @param Twig_Environment $env - The Twig Environment - https://twig.symfony.com/api/1.x/Twig_Environment.html
 * @param $config - Config of `@basalt/twig-renderer`
 */
function addCustomExtension(Environment &$env, $config)
{
  // example of enabling the Twig debug mode extension (ex. {{ dump(my_variable) }} to check out the template's available data) -- comment out to disable
  // $env->addExtension(new Twig\Extension\DebugExtension());

  /*
   * Uppercase the first character of a string
   * @param string $theString
   * @example `<p>{{ ucfirst('abc') }}</p>` => `<p>Abc</p>`
   */
  
  // Add folders to Twig loader paths
  $env->getLoader()->addPath("./src/");
  $env->getLoader()->addPath("./src/assets/");
  
  // Register namespaces for each top level folder in components, so they can be used in templates like this: `{% include '@atoms/button.twig' %}`
  $componentsDir = "./src/components/";
  if (is_dir($componentsDir)) {
    $folders = scandir($componentsDir);
    foreach ($folders as $folder) {
      if ($folder === "." || $folder === "..") {
        continue;
      }
      if(!is_dir($componentsDir . $folder)) {
        continue;
      }
      $env->getLoader()->addPath($componentsDir . $folder, $folder);
    }
  }

  $env->addExtension(new \Twig\Extension\DebugExtension());

  $env->getExtension(\Twig\Extension\CoreExtension::class)->setDateFormat('jS F Y', '%d days');

  $global = json_decode(file_get_contents('./src/data/global.json'), true);

  // Set theme_version from package.json to global variable
  $package = json_decode(file_get_contents('./package.json'), true);
  $global['global']['theme_version'] = isset($package['version']) ? $package['version'] : '1.0.0';

  $env->addGlobal('global', isset($global['global']) ? $global['global'] : new StdClass());

  $global_section_theme = 'default';
  $env->addGlobal('global_section_theme', $global_section_theme);

  $env->addFunction(
    new TwigFunction('triggerSectionThemeUpdate', function ($used_theme) use (
      $env,
      $global_section_theme
    ) {
      if (in_array($used_theme, ['default', 'alternative'])) {
        $global_section_theme = $used_theme === 'default' ? 'alternative' : 'default';
        $env->addGlobal('global_section_theme', $global_section_theme);
      }
    })
  );

  $env->addFunction(
    new TwigFunction('ucfirst', function ($theString) {
      return ucfirst($theString);
    })
  );

  $env->addFilter(
    new TwigFilter('slugify', function ($theString) {
      return strtolower(trim(preg_replace('/[^A-Za-z0-9-]+/', '-', $theString)));
    })
  );

  $env->addFunction(
    new TwigFunction('getColorContrast', function ($color1, $color2) {
      $color1 = str_replace('#', '', $color1);
      $color2 = str_replace('#', '', $color2);
      return evaluateColorContrast($color1, $color2);
    })
  );

  $env->addTest(
    new \Twig\TwigTest('string', function ($value) {
      return is_string($value);
    })
  );

  $env->addFunction(
    new TwigFunction('normaliseButtonData', function ($data) {
      if (!is_array($data)) {
        $data = [];
      }

      if (!isset($data['is_preview'])) {
        $data['is_preview'] = false;
      }

      if (!isset($data['element'])) {
        $data['element'] = 'button';
      }

      if (!isset($data['attributes'])) {
        $data['attributes'] = [];
      }
      if (!isset($data['attributes']['class'])) {
        $data['attributes']['class'] = [];
      }
      if (!is_array($data['attributes']['class'])) {
        $data['attributes']['class'] = [$data['attributes']['class']];
      }
      $data['attributes']['class'][] = 'button';

      if (!isset($data['attributes_string'])) {
        $data['attributes_string'] = '';
      }

      if (!isset($data['iconStart'])) {
        $data['iconStart'] = false;
      }
      if (!isset($data['iconEnd'])) {
        $data['iconEnd'] = false;
      }

      // Icon shortcut
      if (isset($data['icon'])) {
        $data['iconEnd'] = $data['icon'];
      }

      if (is_string($data['iconStart'])) {
        $data['iconStart'] = ['name' => $data['iconStart'], 'type' => 'fa'];
      }
      if (is_string($data['iconEnd'])) {
        $data['iconEnd'] = ['name' => $data['iconEnd'], 'type' => 'fa'];
      }

      if (empty($data['link'])) {
        $data['link'] = [];
      }
      if (is_string($data['link'])) {
        $data['link'] = ['url' => $data['link']];
      }

      if (isset($data['link_type'])) {
        if ($data['link_type'] == 'internal' && isset($data['link']['internal'])) {
          $data['link']['url'] = $data['link']['internal'];
        } elseif ($data['link_type'] == 'external' && isset($data['link']['external'])) {
          $data['link']['url'] = $data['link']['external'];
        } elseif (
          $data['link_type'] == 'internal_media' &&
          isset($data['link']['internal_media'])
        ) {
          $data['link']['url'] = $data['link']['internal_media'];
        }
      }

      if (isset($data['url']) && is_string($data['url'])) {
        $data['link']['url'] = $data['url'];
      }
      if (isset($data['target']) && is_string($data['target'])) {
        $data['link']['target'] = $data['target'];
      }

      if (!isset($data['link']['url'])) {
        $data['link']['url'] = false;
      }
      if (!isset($data['link']['target'])) {
        $data['link']['target'] = '';
      }
      if (!isset($data['link']['rel'])) {
        $data['link']['rel'] = 'noopener noreferrer';
      }

      if ($data['link']['url']) {
        $data['element'] = 'a';
        $data['attributes']['href'] = $data['link']['url'];
        $data['attributes']['target'] = $data['link']['target'];
        $data['attributes']['rel'] = $data['link']['rel'];
      }

      if (isset($data['hover']) && !$data['hover']) {
        $data['attributes']['data-hover'] = 'false';
      }

      return $data;
    })
  );

  $env->addFunction(
    new TwigFunction('pullKeys', function ($data, $key) {
      $return = [];
      foreach ($data as $d) {
        if (isset($d[$key])) {
          if (!in_array($d[$key], $return)) {
            $return[] = $d[$key];
          }
        }
      }
      return $return;
    })
  );

  $env->addFunction(
    new TwigFunction('getCookie', function ($cookieName) {
      if (isset($_COOKIE[$cookieName])) {
        return $_COOKIE[$cookieName];
      }
      return false;
    })
  );

  $env->addFilter(
    new TwigFilter('toAttributes', function ($attributes) {
      $attributesString = '';

      if (!is_array($attributes) && !is_object($attributes)) {
        $attributes = [];
      }

      foreach ($attributes as $key => $value) {
        if (is_array($value)) {
          $value = implode(' ', $value);
        }
        if ($value) {
          $attributesString .= $key . '="' . esc_attr($value) . '" ';
        }
      }

      return $attributesString;
    })
  );

  $env->addFilter(
    new TwigFilter('filterContent', function ($theString) {
      $theString = str_replace('<table', "<div class='table-wrapper'><table", $theString);
      $theString = str_replace('</table>', '</table></div>', $theString);
      return $theString;
    })
  );
  $env->addFilter(
    new TwigFilter('toImageHTML', function ($img, $size = 'full', $class = '') {
      if (is_array($img)) {
        return '';
      }
      return $img;
    })
  );

  $env->addFilter(
    new TwigFilter('cleanSVG', function ($svg) {
      // Remove <?xml line
      $svg = preg_replace('/<\?xml.*\?>/', '', $svg);
      // Remove id=""
      $svg = preg_replace('/\s*id="[^"]*"/', '', $svg);
      // Remove data-name=""
      $svg = preg_replace('/\s*data-name="[^"]*"/', '', $svg);
      // Remove <defs>...</defs>
      $svg = preg_replace('/<defs>.*<\/defs>/s', '', $svg);
      return $svg;
    })
  );

  $env->addFunction(
    new TwigFunction('get_embed', function ($name) {
      return get_template($name, 'embed');
    })
  );
  $env->addFunction(
    new TwigFunction('get_macro', function ($name) {
      return get_template($name, 'macro');
    })
  );

  $env->addFunction(
    new TwigFunction('getJSON', function ($name) {
      if (is_string($name)) {
        $name = json_decode(file_get_contents($name), true);
      }
      if (is_object($name) || is_array($name)) {
        return $name;
      }
      return [];
    })
  );

  $env->addFunction(
    new TwigFunction('get_youtube_video_id', function ($url) {
      return get_youtube_video_id($url);
    })
  );

  $env->addFunction(
    new Twig\TwigFunction('show_breadcrumbs', function () {
      if (function_exists('yoast_breadcrumb')) {
        echo yoast_breadcrumb('<p id="breadcrumbs">', '</p>');
      } else {
        echo '<span>
    <span><a href="#">Home</a></span>
    <span><a href="#">Lorem ipsum dolor sit (37 characters)</a></span>
    <span class="breadcrumb_last" aria-current="page">
      Lorem ipsum dolor sit amet, consectetur adipiscing elit. (72 characters)
    </span>
  </span>';
      }
    })
  );

  $env->addFilter(
    new Twig\TwigFilter('parseMarketoFormID', function ($id) {
      return $id;
    })
  );
}

function get_template($name, $type = 'macro')
{
  $level1 = 'atoms';
  $level2 = '';
  $level3 = '';

  $name_parts = explode('/', $name);
  if (count($name_parts) == 1) {
    $level2 = $level3 = $name_parts[0];
  } elseif (count($name_parts) == 2) {
    $level1 = $name_parts[0];
    $level2 = $name_parts[1];
    $level3 = $name_parts[1];
  } elseif (count($name_parts) == 3) {
    $level1 = $name_parts[0];
    $level2 = $name_parts[1];
    $level3 = $name_parts[2];
  }

  return "{$level1}/{$level2}/_includes/{$level3}.{$type}.twig";
}

// calculates the luminosity of an given RGB color
// the color code must be in the format of RRGGBB
// the luminosity equations are from the WCAG 2 requirements
// http://www.w3.org/TR/WCAG20/#relativeluminancedef

function calculateLuminosity($color)
{
  $r = hexdec(substr($color, 0, 2)) / 255; // red value
  $g = hexdec(substr($color, 2, 2)) / 255; // green value
  $b = hexdec(substr($color, 4, 2)) / 255; // blue value
  if ($r <= 0.03928) {
    $r = $r / 12.92;
  } else {
    $r = pow(($r + 0.055) / 1.055, 2.4);
  }

  if ($g <= 0.03928) {
    $g = $g / 12.92;
  } else {
    $g = pow(($g + 0.055) / 1.055, 2.4);
  }

  if ($b <= 0.03928) {
    $b = $b / 12.92;
  } else {
    $b = pow(($b + 0.055) / 1.055, 2.4);
  }

  $luminosity = 0.2126 * $r + 0.7152 * $g + 0.0722 * $b;
  return $luminosity;
}

// calculates the luminosity ratio of two colors
// the luminosity ratio equations are from the WCAG 2 requirements
// http://www.w3.org/TR/WCAG20/#contrast-ratiodef

function calculateLuminosityRatio($color1, $color2)
{
  $l1 = calculateLuminosity($color1);
  $l2 = calculateLuminosity($color2);

  if ($l1 > $l2) {
    $ratio = ($l1 + 0.05) / ($l2 + 0.05);
  } else {
    $ratio = ($l2 + 0.05) / ($l1 + 0.05);
  }
  return $ratio;
}

// returns an array with the results of the color contrast analysis
// it returns akey for each level (AA and AAA, both for normal and large or bold text)
// it also returns the calculated contrast ratio
// the ratio levels are from the WCAG 2 requirements
// http://www.w3.org/TR/WCAG20/#visual-audio-contrast (1.4.3)
// http://www.w3.org/TR/WCAG20/#larger-scaledef

function evaluateColorContrast($color1, $color2)
{
  $ratio = calculateLuminosityRatio($color1, $color2);

  $colorEvaluation['levelAANormal'] = $ratio >= 4.5 ? 'pass' : 'fail';
  $colorEvaluation['levelAALarge'] = $ratio >= 3 ? 'pass' : 'fail';
  $colorEvaluation['levelAAMediumBold'] = $ratio >= 3 ? 'pass' : 'fail';
  $colorEvaluation['levelAAANormal'] = $ratio >= 7 ? 'pass' : 'fail';
  $colorEvaluation['levelAAALarge'] = $ratio >= 4.5 ? 'pass' : 'fail';
  $colorEvaluation['levelAAAMediumBold'] = $ratio >= 4.5 ? 'pass' : 'fail';
  $colorEvaluation['ratio'] = $ratio;

  return $colorEvaluation;
}

/* Media */
if (!function_exists('get_youtube_video_id')) {
  function get_youtube_video_id($url)
  {
    $videoId = '';
    if (!is_string($url)) {
      $url = '';
    }

    if (strpos($url, 'http') === false) {
      return $url;
    }

    $urlParts = parse_url($url);
    if (isset($urlParts['query'])) {
      parse_str($urlParts['query'], $query);
      if (isset($query['v'])) {
        $videoId = $query['v'];
      }
    } else {
      $pathParts = explode('/', $urlParts['path']);
      if (isset($pathParts[1])) {
        $videoId = $pathParts[1];
      }
    }
    return $videoId;
  }
}

/* Wordpress specific functions */
if (!function_exists('esc_attr')) {
  function esc_attr($string)
  {
    return htmlspecialchars($string, ENT_QUOTES, 'UTF-8');
  }
}
