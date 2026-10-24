<?php
/**
 * PTT 3D SMART BOARD - Authentication Endpoint (PHP Backend for Apache)
 * Verifies credentials using salted SHA-256 hash without hardcoding plain passwords in code.
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$configFile = __DIR__ . '/auth_config.json';
if (!file_exists($configFile)) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'Authentication config file not found']);
    exit;
}

$config = json_decode(file_get_contents($configFile), true);
$salt = $config['salt'] ?? 'ptt_gsp_salt_2026';
$expectedAuthHash = $config['authHash'] ?? '';
$expectedUserHash = $config['userHash'] ?? '';

// Read JSON input
$raw = file_get_contents('php://input');
$data = json_decode($raw, true) ?? [];

$username = trim($data['username'] ?? '');
$password = trim($data['password'] ?? '');

if (empty($username) || empty($password)) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'กรุณากรอกชื่อผู้ใช้งานและรหัสผ่าน']);
    exit;
}

// Calculate salted SHA-256 hash
$calcAuthHash = hash('sha256', $username . ':' . $password . ':' . $salt);
$calcUserHash = hash('sha256', $username . ':' . $salt);

if (hash_equals($expectedAuthHash, $calcAuthHash)) {
    // Generate secure session token
    $token = bin2hex(random_bytes(24));
    echo json_encode([
        'ok' => true,
        'message' => 'เข้าสู่ระบบสำเร็จ',
        'token' => $token,
        'username' => $username,
        'expiresIn' => 86400
    ]);
} else {
    http_response_code(401);
    echo json_encode([
        'ok' => false,
        'error' => 'ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง'
    ]);
}
