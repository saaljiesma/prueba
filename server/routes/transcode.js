const express = require('express');
const router = express.Router();
const { spawn } = require('child_process');

/**
 * Stream VOD/LIVE optimizado para Raspberry Pi 4
 * Habilita la barra de búsqueda y soluciona desconexiones prematuras
 */
router.get('/', (req, res) => {
    const { url, type } = req.query;
    if (!url) return res.status(400).json({ error: 'URL parameter is required' });

    const ffmpegPath = req.app.locals.ffmpegPath || 'ffmpeg';

    // 1. DETECCIÓN AUTOMÁTICA DE VOD (Películas/Series)
    const isVOD = type === 'vod' || 
                  url.includes('/movie/') || 
                  url.includes('/series/') || 
                  url.toLowerCase().endsWith('.mkv') || 
                  url.toLowerCase().endsWith('.mp4');

    // 2. CONFIGURACIÓN DE MOVFLAGS PARA HABILITAR EL SEEK
    // faststart: Mueve los índices al principio para que el navegador sepa la duración.
    // frag_discont: Ayuda a que el navegador no se corte si hay baches en la red.
    const movFlags = isVOD
        ? 'faststart+empty_moov+omit_tfhd_offset+frag_discont' 
        : 'frag_keyframe+empty_moov+default_base_moof';

    // 3. HEADERS DE COMPATIBILIDAD
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    
    // Crucial para que el navegador permita saltar a cualquier punto
    if (isVOD) {
        res.setHeader('Accept-Ranges', 'bytes');
    }

    // 4. ARGUMENTOS DE FFMPEG (Equilibrio estabilidad/rendimiento)
    const args = [
        '-hide_banner',
        '-loglevel', 'warning',
        
        // Robustez ante cortes del servidor IPTV
        '-reconnect', '1',
        '-reconnect_at_eof', '1',
        '-reconnect_streamed', '1',
        '-reconnect_delay_max', '5',
        
        '-i', url, // Entrada remota

        '-map', '0:v:0',
        '-map', '0:a:0?',
        
        // Remuxing: Video directo (0% CPU) y Audio a AAC (Compatible universal)
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-ac', '2',
        '-b:a', '128k', // Bitrate eficiente para evitar saturar el buffer
        
        '-af', 'aresample=async=1:min_hard_comp=0.100:first_pts=0',
        
        '-f', 'mp4',
        '-movflags', movFlags,
        '-bufsize', isVOD ? '32M' : '10M', // Buffer optimizado para RPi4
        '-max_muxing_queue_size', '4096',
        '-'
    ];

    console.log(`[NodeCast] Iniciando: ${isVOD ? 'PELÍCULA (Seek Habilitado)' : 'LIVE'}`);
    
    const ffmpeg = spawn(ffmpegPath, args);

    // Enviar el stream al navegador
    ffmpeg.stdout.pipe(res);

    // Captura de errores para depuración
    ffmpeg.stderr.on('data', data => {
        const msg = data.toString();
        if (msg.toLowerCase().includes('error')) {
            console.error('[FFmpeg Error]', msg.trim());
        }
    });

    // 5. GESTIÓN DE DESCONEXIÓN (Evita el "Cliente desconectado" por peticiones dobles)
    req.on('close', () => {
        // Esperamos 3 segundos antes de matar el proceso por si el navegador 
        // solo está reiniciando la conexión para pedir un rango de bytes (Seeking)
        setTimeout(() => {
            if (req.aborted || res.finished || !res.writable) {
                console.log('[Stream] Cliente desconectado permanentemente. Matando FFmpeg...');
                ffmpeg.kill('SIGKILL');
            }
        }, 3000);
    });

    ffmpeg.on('exit', code => {
        if (code && code !== 255) {
            console.log(`[Stream] FFmpeg finalizó con código ${code}`);
        }
    });
});

module.exports = router;