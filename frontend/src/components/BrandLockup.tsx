type BrandLockupProps = {
  inverted?: boolean;
};

function BrandLockup({ inverted = false }: BrandLockupProps) {
  return (
    <div className="flex items-center gap-3">
      <div
        className={`grid place-items-center rounded-2xl text-lg font-black shadow-lg ${
          inverted ? 'h-12 w-12 bg-white text-[#4a154b]' : 'h-11 w-11 bg-[#4a154b] text-white shadow-[#4a154b]/20'
        }`}
      >
        P
      </div>
      <div>
        <p className={`text-sm font-bold uppercase tracking-[0.18em] ${inverted ? 'text-white/60' : 'text-[#4a154b]'}`}>PulseChat</p>
        <p className={`text-sm ${inverted ? 'text-white/75' : 'text-[#69646b]'}`}>Team communication hub</p>
      </div>
    </div>
  );
}

export default BrandLockup;
