<?php
/**
 * PTT 3D SMART BOARD - MS Teams Notification Backend (PHP for Apache)
 * Manages notification settings and forwards alerts to MS Teams Power Automate webhook.
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$configFile = __DIR__ . '/notify_config.json';

// Ensure config file exists with default values
function getConfig($configFile) {
    $default = [
        'webhookUrl' => 'https://defaultf2fda5e72ea1450d9fc12af5f86300.95.environment.api.powerplatform.com/powerautomate/automations/direct/cu/18/workflows/904ec45ba2f343b0bf609507bba19298/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=P7wxp36yBmVsRRsQL6hEIYzC7BoO9r8IUQrmM8_9Xfc',
        'scheduleEnabled' => true,
        'scheduleTimes' => ['08:00', '20:00'],
        'scheduleTime' => '08:00, 20:00',
        'lastSent' => null,
        'lastStatus' => null,
        'lastError' => null,
        'sendLogs' => []
    ];
    if (file_exists($configFile)) {
        $raw = file_get_contents($configFile);
        $json = json_decode($raw, true);
        if (is_array($json)) {
            return array_merge($default, $json);
        }
    }
    return $default;
}

function saveConfig($configFile, $config) {
    file_put_contents($configFile, json_encode($config, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
}

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

// GET: Return config (strip sensitive webhookUrl from public responses)
if ($method === 'GET' || ($method === 'POST' && $action === 'get_config')) {
    $cfg = getConfig($configFile);
    unset($cfg['webhookUrl']);
    echo json_encode(['ok' => true, 'config' => $cfg]);
    exit;
}

// POST: Save config or Send notification
if ($method === 'POST') {
    $raw = file_get_contents('php://input');
    $data = json_decode($raw, true) ?? [];
    $cfg = getConfig($configFile);

    // 1. Send Notification Action
    if ($action === 'send' || isset($data['action']) && $data['action'] === 'send' || isset($data['reason'])) {
        $webhookUrl = trim($data['webhookUrl'] ?? $cfg['webhookUrl'] ?? '');
        if (empty($webhookUrl)) {
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => 'ไม่พบ Webhook URL ของ MS Teams']);
            exit;
        }

        $payload = $data['payload'] ?? $data;
        $jsonPayload = json_encode($payload, JSON_UNESCAPED_UNICODE);

        // Forward to Power Automate via cURL
        $ch = curl_init($webhookUrl);
        curl_setopt($ch, CURLOPT_CUSTOMREQUEST, 'POST');
        curl_setopt($ch, CURLOPT_POSTFIELDS, $jsonPayload);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 15);
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
        curl_setopt($ch, CURLOPT_HTTPHEADER, [
            'Content-Type: application/json; charset=utf-8',
            'Content-Length: ' . strlen($jsonPayload)
        ]);

        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlError = curl_error($ch);
        curl_close($ch);

        $nowStr = date('d/m/Y H:i:s');
        if ($httpCode >= 200 && $httpCode < 300) {
            $statusMsg = "สำเร็จ ({$httpCode} Accepted)";
            $cfg['lastSent'] = $nowStr;
            $cfg['lastStatus'] = $statusMsg;
            $cfg['lastError'] = null;
            $logEntry = [
                'timestamp' => $nowStr,
                'reason' => $data['reason'] ?? 'ส่งทันที (Manual)',
                'status' => $statusMsg,
                'statusCode' => $httpCode,
                'ok' => true
            ];
            array_unshift($cfg['sendLogs'], $logEntry);
            $cfg['sendLogs'] = array_slice($cfg['sendLogs'], 0, 20);
            saveConfig($configFile, $cfg);

            echo json_encode([
                'ok' => true,
                'status' => $httpCode,
                'message' => $statusMsg,
                'timestamp' => $nowStr
            ]);
        } else {
            $errMsg = $curlError ?: "HTTP Error {$httpCode}: {$response}";
            $cfg['lastStatus'] = $errMsg;
            $cfg['lastError'] = $errMsg;
            $logEntry = [
                'timestamp' => $nowStr,
                'reason' => $data['reason'] ?? 'ส่งทันที (Manual)',
                'status' => $errMsg,
                'statusCode' => $httpCode ?: 0,
                'ok' => false
            ];
            array_unshift($cfg['sendLogs'], $logEntry);
            $cfg['sendLogs'] = array_slice($cfg['sendLogs'], 0, 20);
            saveConfig($configFile, $cfg);

            http_response_code(502);
            echo json_encode(['ok' => false, 'error' => $errMsg]);
        }
        exit;
    }

    // 2. Save Config Action
    if (isset($data['webhookUrl']) && is_string($data['webhookUrl'])) {
        $cfg['webhookUrl'] = trim($data['webhookUrl']);
    }
    if (isset($data['scheduleEnabled'])) {
        $cfg['scheduleEnabled'] = (bool)$data['scheduleEnabled'];
    }
    if (isset($data['scheduleTimes']) && is_array($data['scheduleTimes'])) {
        $cfg['scheduleTimes'] = array_values(array_filter(array_map('trim', $data['scheduleTimes'])));
        $cfg['scheduleTime'] = implode(', ', $cfg['scheduleTimes']);
    } elseif (isset($data['scheduleTime']) && is_string($data['scheduleTime'])) {
        $cfg['scheduleTime'] = trim($data['scheduleTime']);
        $cfg['scheduleTimes'] = array_values(array_filter(array_map('trim', explode(',', str_replace(';', ',', $cfg['scheduleTime'])))));
    }
    if (isset($data['scheduleDays']) && is_array($data['scheduleDays'])) {
        $cfg['scheduleDays'] = array_values(array_filter(array_map('trim', $data['scheduleDays'])));
    }

    saveConfig($configFile, $cfg);
    echo json_encode(['ok' => true, 'config' => $cfg]);
    exit;
}
