import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Package, X, Check, Info, Plus, Minus } from 'lucide-react';
import { getBaggageFees } from '../../services/fareService';
import type { BaggageFee, BaggageSelection } from '../../types';

interface BaggageFeeSelectorProps {
  onSelect: (selection: BaggageSelection | null) => void;
  onClose: () => void;
  isOpen: boolean;
}

const BaggageFeeSelector: React.FC<BaggageFeeSelectorProps> = ({ onSelect, onClose, isOpen }) => {
  const [baggageFees, setBaggageFees] = useState<BaggageFee[]>([]);
  const [selectedFee, setSelectedFee] = useState<BaggageFee | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isOpen) {
      loadBaggageFees();
    }
  }, [isOpen]);

  async function loadBaggageFees() {
    setLoading(true);
    try {
      const fees = await getBaggageFees();
      // Deduplicate fees by category to prevent duplicates
      const uniqueFees = fees.reduce((acc, fee) => {
        const existing = acc.find(f => f.category === fee.category);
        if (existing) {
          return acc; // Skip duplicates
        }
        return [...acc, fee];
      }, [] as BaggageFee[]);
      setBaggageFees(uniqueFees);
    } catch (error) {
      console.error('Error loading baggage fees:', error);
    } finally {
      setLoading(false);
    }
  }

  function handleSelectFee(fee: BaggageFee) {
    if (selectedFee?.id === fee.id) {
      // Deselect if already selected
      setSelectedFee(null);
      setQuantities({});
    } else {
      setSelectedFee(fee);
      setQuantities({ [fee.id]: 1 }); // Default quantity to 1
    }
  }

  function handleQuantityChange(feeId: string, delta: number) {
    setQuantities(prev => {
      const current = prev[feeId] || 1;
      const newQuantity = Math.max(1, current + delta);
      return { ...prev, [feeId]: newQuantity };
    });
  }

  function handleConfirm() {
    if (selectedFee) {
      const quantity = quantities[selectedFee.id] || 1;
      onSelect({
        category: selectedFee.category,
        fee: selectedFee.fee * quantity, // Multiply fee by quantity
        weight: selectedFee.max_weight_kg * quantity, // Multiply weight by quantity
        quantity: quantity
      });
    } else {
      onSelect(null);
    }
    onClose();
  }

  function handleSkip() {
    onSelect(null);
    setSelectedFee(null);
    setQuantities({});
    onClose();
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="modal-overlay"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 20
          }}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className="modal-content glass-card"
            style={{
              background: 'rgba(255, 255, 255, 0.1)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              borderRadius: 16,
              maxWidth: 500,
              width: '100%',
              maxHeight: '80vh',
              overflow: 'auto',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)'
            }}
          >
            {/* Header */}
            <div style={{
              padding: 20,
              borderBottom: '1px solid rgba(255, 255, 255, 0.2)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{
                  background: 'var(--color-primary-subtle)',
                  padding: 8,
                  borderRadius: 8
                }}>
                  <Package size={20} color="var(--color-primary)" />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                    Baggage Fee
                  </h3>
                  <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                    Select baggage category (optional)
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                style={{
                  background: 'var(--bg-secondary)',
                  border: '2px solid var(--border-medium)',
                  cursor: 'pointer',
                  padding: 8,
                  borderRadius: 8,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <X size={20} color="var(--text-primary)" />
              </button>
            </div>

            {/* Content */}
            <div style={{ padding: 20 }}>
              {loading ? (
                <div style={{ textAlign: 'center', padding: 40 }}>
                  <div style={{ color: 'var(--text-secondary)' }}>Loading baggage fees...</div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {baggageFees.map((fee) => (
                    <motion.div
                      key={fee.id}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => handleSelectFee(fee)}
                      style={{
                        border: `2px solid ${selectedFee?.id === fee.id ? 'var(--color-primary)' : 'rgba(255, 255, 255, 0.2)'}`,
                        borderRadius: 12,
                        padding: 16,
                        cursor: 'pointer',
                        background: selectedFee?.id === fee.id ? 'var(--color-primary-subtle)' : 'rgba(255, 255, 255, 0.05)',
                        backdropFilter: 'blur(8px)',
                        WebkitBackdropFilter: 'blur(8px)',
                        transition: 'all 0.2s ease'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <div style={{
                            width: 40,
                            height: 40,
                            borderRadius: 8,
                            background: selectedFee?.id === fee.id ? 'var(--color-primary)' : 'rgba(255, 255, 255, 0.1)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}>
                            {selectedFee?.id === fee.id ? (
                              <Check size={20} color="white" />
                            ) : (
                              <Package size={20} color="var(--text-secondary)" />
                            )}
                          </div>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>
                              {fee.category}
                            </div>
                            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                              Max weight: {fee.max_weight_kg} kg
                            </div>
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--color-primary)' }}>
                              ₱{fee.fee.toFixed(2)}
                            </div>
                            {fee.remarks && (
                              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                {fee.remarks}
                              </div>
                            )}
                          </div>
                          {selectedFee?.id === fee.id && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleQuantityChange(fee.id, -1);
                                }}
                                style={{
                                  width: 32,
                                  height: 32,
                                  borderRadius: 6,
                                  border: '2px solid var(--color-primary)',
                                  background: 'var(--bg-secondary)',
                                  color: 'var(--color-primary)',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  cursor: 'pointer',
                                  fontSize: '1.2rem',
                                  fontWeight: 700
                                }}
                              >
                                -
                              </button>
                              <span style={{ 
                                fontWeight: 700, 
                                fontSize: '1rem', 
                                minWidth: 24, 
                                textAlign: 'center',
                                color: 'var(--color-primary)'
                              }}>
                                {quantities[fee.id] || 1}
                              </span>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleQuantityChange(fee.id, 1);
                                }}
                                style={{
                                  width: 32,
                                  height: 32,
                                  borderRadius: 6,
                                  border: '1px solid var(--color-primary)',
                                  background: 'var(--color-primary)',
                                  color: 'white',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  cursor: 'pointer',
                                  fontSize: '1.2rem',
                                  fontWeight: 700
                                }}
                              >
                                +
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}

              {/* Info message */}
              <div style={{
                marginTop: 16,
                padding: 12,
                background: 'rgba(255, 255, 255, 0.05)',
                backdropFilter: 'blur(8px)',
                WebkitBackdropFilter: 'blur(8px)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: 8,
                display: 'flex',
                gap: 10,
                alignItems: 'flex-start'
              }}>
                <Info size={16} color="var(--text-secondary)" style={{ marginTop: 2, flexShrink: 0 }} />
                <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  Baggage fees are optional. Select a category if the passenger has baggage that requires a fee. The first 7kg carry-on is free.
                </p>
              </div>
            </div>

            {/* Footer */}
            <div style={{
              padding: 20,
              borderTop: '1px solid rgba(255, 255, 255, 0.2)',
              display: 'flex',
              gap: 12
            }}>
              <button
                onClick={handleSkip}
                style={{
                  flex: 1,
                  padding: 14,
                  borderRadius: 10,
                  border: '2px solid var(--border-medium)',
                  background: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  fontSize: '0.95rem',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                No Baggage
              </button>
              <button
                onClick={handleConfirm}
                style={{
                  flex: 1,
                  padding: 14,
                  borderRadius: 10,
                  border: 'none',
                  background: 'var(--color-primary)',
                  color: 'white',
                  fontSize: '0.95rem',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                {selectedFee ? `Add ₱${selectedFee.fee.toFixed(2)}` : 'Skip'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default BaggageFeeSelector;