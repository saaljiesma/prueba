const express = require('express');
const router = express.Router();
const { spawn } = require('child_process');

/**
 * Stream VOD/LIVE optimizado para Raspberry Pi 4
 * Soluciona el error de corte prematuro y habilita la barra de búsqueda
 */
router.get('/', (req, res) => {
    const { url, type } = req.query;
    if (!url) return res.status(400).json({ error: 'URL parameter is required' });

    const ffmpegPath = req.app.locals.ffmpegPath || 'ffmpeg';

    // Identifica si es película por el parámetro o por el nombre del archivo
    const isVOD = type === 'vod' || 
                  url.includes('/movie/') || 
                  url.includes('/series/') || 
                  url.toLowerCase().endsWith('.mkv') || 
                  url.toLowerCase().endsWith('.mp4');

    // CONFIGURACIÓN DE MOVFLAGS
    // Para VOD: Quitamos frag_keyframe para que el navegador permita el salto (seek).
    const movFlags = isVOD
        ? 'faststart+empty_moov+omit_tfhd_offset+frag_discont' 
        : 'frag_keyframe+empty_moov+default_base_moof';

    // Buffer equilibrado: 32M es suficiente para estabilizar sin que el servidor te banee.
    const bufSize = isVOD ? '32M' : '10M';

    // Headers para el navegador
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (isVOD) res.setHeader('Accept-Ranges', 'bytes'); 

    // ARGUMENTOS DE FFMPEG
    const args = [
        '-hide_banner',
        '-loglevel', 'warning',
        
        // Parámetros de robustez de red (Para evitar el error de I/O error)
        '-reconnect', '1',
        '-reconnect_at_eof', '1',
        '-reconnect_streamed', '1',
        '-reconnect_delay_max', '10', // Más tiempo de espera entre intentos
        
        '-i', url, // Entrada de video (IPTV)

        '-map', '0:v:0',
        '-map', '0:a:0?',
        
        // Procesamiento: Copia video (CPU 0%) y convierte audio a AAC (Universal)
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-ac', '2',
        '-b:a', '192k',
        
        // Sincronización de audio/video si hay cortes de red
        '-af', 'aresample=async=1:min_hard_comp=0.100:first_pts=0',
        
        '-f', 'mp4',
        '-movflags', movFlags,
        '-bufsize', bufSize,
        '-max_muxing_queue_size', '4096',
        '-' // Salida a stdout
    ];

    console.log(`[NodeCast] Modo: ${isVOD ? 'PELÍCULA (Seek Habilitado)' : 'LIVE'}`);
    console.log(`[FFmpeg] Comando: ${ffmpegPath} ${args.join(' ')}`);

    const ffmpeg = spawn(ffmpegPath, args);

    // Pipe de datos al cliente
    ffmpeg.stdout.pipe(res);

    // Captura de errores en el log
    ffmpeg.stderr.on('data', data => {
        const msg = data.toString();
        if (msg.toLowerCase().includes('error')) {
            console.error('[FFmpeg Error Detail]', msg.trim());
        }
    });

    // Limpieza al desconectar el usuario
    req.on('close', () => {
        console.log('[Stream] Cliente desconectado. Matando proceso FFmpeg...');
        ffmpeg.kill('SIGKILL');
    });

    ffmpeg.on('exit', (code) => {
        if (code && code !== 255) {
            console.log(`[Stream] FFmpeg finalizó con código ${code}`);
        }
    });

    ffmpeg.on('error', err => {
        console.error('[Stream] Error al lanzar FFmpeg:', err);
    });
});

module.exports = router;