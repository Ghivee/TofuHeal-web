<?php
/**
 * Tofu-Heal Analysis Processor
 * Digunakan untuk menerima dan menyimpan data hasil analisis pH dari aplikasi.
 */

header('Content-Type: application/json');

// Mengambil data JSON dari request body
$json = file_get_contents('php://input');
$data = json_decode($json, true);

if ($data) {
    // Logika penyimpanan data (Misalnya simpan ke database atau file log)
    // Untuk saat ini, kita hanya akan mengembalikan data yang diterima sebagai konfirmasi.
    
    $response = [
        'status' => 'success',
        'message' => 'Data analisis berhasil diterima',
        'received_data' => [
            'rgb' => $data['rgb'] ?? null,
            'hsv' => $data['hsv'] ?? null,
            'ph_estimation' => $data['ph_estimation'] ?? 'N/A',
            'timestamp' => date('Y-m-d H:i:s')
        ]
    ];
    
    // Opsional: Simpan ke file log lokal
    file_put_contents('analysis_log.txt', json_encode($response) . PHP_EOL, FILE_APPEND);

    echo json_encode($response);
} else {
    echo json_encode([
        'status' => 'error',
        'message' => 'Tidak ada data yang valid diterima'
    ]);
}
?>
