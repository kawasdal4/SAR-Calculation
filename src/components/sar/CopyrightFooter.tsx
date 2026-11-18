'use client'

import React, { useState } from 'react'
import { motion } from 'framer-motion'
import CopyrightPopup from './CopyrightPopup'

interface CopyrightFooterProps {
  className?: string
  text?: string
  year?: string | number
  align?: 'left' | 'center' | 'right'
}

/**
 * Komponen Desain Copyright Asli dari Web App E-Katalog SOP Basarnas
 * Menampilkan tombol copyright beranimasi glow & shimmer dengan popup pop-out profil developer & hak cipta.
 */
export default function CopyrightFooter({
  className = '',
  text = 'FOE',
  year = '2026',
  align = 'center',
}: CopyrightFooterProps) {
  const [showPopup, setShowPopup] = useState(false)

  const alignClass = 
    align === 'left' ? 'justify-start' :
    align === 'right' ? 'justify-end' :
    'justify-center'

  return (
    <>
      <div className={`relative z-10 py-3 px-4 flex ${alignClass} ${className}`}>
        <motion.button
          type="button"
          onClick={() => setShowPopup(true)}
          className="group relative cursor-pointer focus:outline-none"
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
        >
          {/* Animated Glow Effect */}
          <motion.div
            className="absolute inset-0 bg-gradient-to-r from-orange-500 to-yellow-400 rounded-lg blur-md opacity-50"
            animate={{ opacity: [0.35, 0.65, 0.35] }}
            transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
          />

          {/* Container Card */}
          <div className="relative px-6 py-2.5 bg-gradient-to-r from-gray-900 via-gray-800 to-gray-900 rounded-lg border border-orange-500/30 overflow-hidden hover:border-orange-500/60 transition-colors shadow-lg shadow-black/40">
            {/* Animated Shimmer Light Sweep */}
            <motion.div
              className="absolute inset-0 pointer-events-none"
              style={{
                background: 'linear-gradient(90deg, transparent 0%, rgba(251,191,36,0.18) 50%, transparent 100%)',
                backgroundSize: '200% 100%',
              }}
              animate={{ backgroundPosition: ['200% 0', '-200% 0'] }}
              transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
            />

            {/* Typography */}
            <p className="text-sm font-bold relative z-10 text-center tracking-wide">
              <span className="text-gray-400">© </span>
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-orange-400 via-yellow-300 to-orange-400">
                {text} - {year}
              </span>
            </p>
          </div>
        </motion.button>
      </div>

      {/* Pop-out Modal Hak Cipta */}
      <CopyrightPopup show={showPopup} onClose={() => setShowPopup(false)} />
    </>
  )
}
