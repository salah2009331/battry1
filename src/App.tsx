/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { 
  Battery, 
  Send, 
  Copy, 
  Check, 
  Trash2, 
  Plus, 
  CheckCircle2, 
  Droplets, 
  Zap, 
  Settings2, 
  Info,
  ChevronDown,
  Cpu,
  Calendar,
  Clock,
  Factory,
  Search,
  Camera,
  History,
  AlertTriangle,
  BookOpen,
  ChevronRight,
  ChevronLeft,
  Image,
  Upload,
  Minus
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Html5Qrcode } from 'html5-qrcode';
import Tesseract from 'tesseract.js';
import { processImageWithAI, OCR_PROMPT, ENHANCEMENT_PROMPT } from './services/geminiService';
import { BATTERY_MODELS, BATTERY_CODE_MAPPING, type ReportData } from './constants';
import { preprocessForOCR, fuzzyDecode } from './utils/ocrUtils';

const INITIAL_STATE: ReportData = {
  fillingAcid: { enabled: false, density: '', model: '', temp: '' },
  afterCharging: { density: '', model: '', temp: '' },
  levelAdjustment: { density: '', temp: '' },
  generalDensity: { density: '', model: '', temp: '' },
};

const STORAGE_KEY = 'como_battery_report_data';

const calculateCorrectedDensity = (density: string, temp: string) => {
  const d = parseFloat(density);
  const t = parseFloat(temp);
  if (isNaN(d) || isNaN(t)) return null;
  // Standard correction formula: D25 = Dt + 0.0007 * (t - 25)
  return (d + 0.0007 * (t - 25)).toFixed(3);
};

interface BatteryDiagnosis {
  status: 'excellent' | 'good' | 'warning' | 'danger' | 'unknown';
  soc: number; // State of Charge %
  message: string;
  color: string;
  action: string;
}

const getBatteryDiagnosis = (density?: string, temp?: string): BatteryDiagnosis => {
  const corrected = density && temp ? parseFloat(calculateCorrectedDensity(density, temp) || '0') : 0;
  
  if (!corrected || corrected === 0) {
    return { status: 'unknown', soc: 0, message: 'في انتظار البيانات...', color: 'text-neutral-400', action: 'أدخل البيانات للبدء' };
  }

  if (corrected >= 1.265) {
    return { 
      status: 'excellent', 
      soc: 100, 
      message: 'البطارية مشحونة بالكامل وحالتها ممتازة', 
      color: 'text-emerald-600',
      action: 'لا يوجد إجراء مطلوب. حافظ على نظافة الأقطاب.'
    };
  } else if (corrected >= 1.225) {
    return { 
      status: 'good', 
      soc: 75, 
      message: 'شحن جيد - كافٍ لتشغيل المحرك بكفاءة', 
      color: 'text-blue-600',
      action: 'يوصى بشحن تكميلي بسيط إذا كانت السيارة تعمل في رحلات قصيرة.'
    };
  } else if (corrected >= 1.190) {
    return { 
      status: 'warning', 
      soc: 50, 
      message: 'تحذير: الشحن منخفض (نصف السعة)', 
      color: 'text-amber-600',
      action: 'يجب شحن البطارية فوراً لتجنب الكبرتة الصلبة.'
    };
  } else if (corrected >= 1.155) {
    return { 
      status: 'danger', 
      soc: 25, 
      message: 'حالة حرجة: البطارية شبه مفرغة', 
      color: 'text-orange-600',
      action: 'خطر! افحص نظام الشحن (الدينامو) وقم بشحن البطارية ببطء (Trickle Charge).'
    };
  } else {
    return { 
      status: 'danger', 
      soc: 0, 
      message: 'البطارية مفرغة تماماً أو تالفة', 
      color: 'text-red-600',
      action: 'احتمال حدوث تلف في الألواح. حاول الشحن السريع مع مراقبة الحرارة، أو استبدل البطارية.'
    };
  }
};

const MONTHS_AR = [
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", 
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"
];

const SHIFTS_AR: Record<string, string> = {
  "A": "الوردية الأولى",
  "B": "الوردية الثانية",
  "C": "الوردية الثالثة"
};

const LINES_AR: Record<string, string> = {
  "A": "الخط الأول",
  "B": "الخط الثاني"
};

const decodeBatteryCode = (code: string) => {
  if (!code) return null;
  
  // 1. Try fuzzy decode for standard format
  const decoded = fuzzyDecode(code);
  
  if (decoded) {
    const { modelId, yearChar, monthChar, day, shiftChar, seqNum, lineChar } = decoded;
    const modelName = BATTERY_CODE_MAPPING[modelId] || "طراز غير معروف";
    
    // Year logic: E = 2026, D = 2025, C = 2024 ...
    const yearDiff = yearChar.charCodeAt(0) - 'E'.charCodeAt(0);
    const productionYear = 2026 + yearDiff;

    const monthIdx = monthChar.charCodeAt(0) - 'A'.charCodeAt(0);
    const monthName = MONTHS_AR[monthIdx] || "شهر غير معروف";

    const shiftName = SHIFTS_AR[shiftChar] || "وردية غير معروفة";
    const lineName = LINES_AR[lineChar] || "خط غير معروف";

    return {
      model: modelName,
      year: productionYear,
      month: monthName,
      day: day,
      shift: shiftName,
      sequence: seqNum,
      line: lineName
    };
  }

  // 2. Fallback for custom/serial codes
  let uppercaseCode = code.toUpperCase().trim().replace(/\s/g, '');
  const genericMatch = uppercaseCode.match(/([A-Z0-9]{8,25})/);
  if (genericMatch) {
    return {
      model: "كود مخصص / تسلسلي",
      year: "غير محدد",
      month: "غير محدد",
      day: genericMatch[0],
      shift: "غير محدد",
      sequence: "غير محدد",
      line: "غير محدد"
    };
  }

  return null;
};

const RESEARCH_PAGES = [
  {
    id: 'chemistry',
    title: "أسرار التفاعل الكيميائي",
    subtitle: "The Electro-Chemical Core",
    content: "داخل كل خلية 2 فولت، يحدث سحر حقيقي. عند الشحن، يغادر الكبريت ألواح الرصاص ليعود إلى السائل، مما يرفع الكثافة. هذه العملية تسمى 'إعادة التشكيل'. أما عند التفريغ، يلتصق الكبريت بالألواح مكوناً كبريتات الرصاص، مما يجعل السائل مائياً وتضعف الكثافة.",
    visual: (stage: any) => <BatteryChemistryVisualizer stage="charge" />,
    tag: "الكيمياء الحيوية"
  },
  {
    id: 'peukert',
    title: "قانون بوكيرت (Peukert's Law)",
    subtitle: "Capacity vs. Load",
    content: "هل تساءلت يوماً لماذا تنفد البطارية بسرعة أكبر عند تشغيل مكيف الهواء؟ قانون بوكيرت يفسر أن سعة البطارية تنخفض فعلياً كلما زاد تيار التفريغ. البطارية ليست خزاناً ثابتاً، بل هي محرك يتأثر بجهد العمل.",
    visual: (stage: any) => <div className="h-48 bg-blue-950 rounded-2xl p-6 flex flex-col justify-end">
      <div className="flex items-end gap-1 h-32">
        {[40, 70, 90, 60, 40, 20].map((h, i) => (
          <motion.div 
            key={i}
            initial={{ height: 0 }}
            animate={{ height: `${h}%` }}
            transition={{ delay: i * 0.1 }}
            className="flex-1 bg-blue-400/40 border-t-2 border-blue-400 rounded-t-sm" 
          />
        ))}
      </div>
      <p className="text-[8px] text-blue-300 font-mono mt-2 uppercase tracking-widest">Capacitive Load Analytics</p>
    </div>,
    tag: "الفيزياء الكهربائية"
  },
  {
    id: 'sulfation',
    title: "ظاهرة الكبرتة المميتة",
    subtitle: "The Silent Killer",
    content: "عندما تترك البطارية فارغة، تتحول كبريتات الرصاص إلى بلورات صلبة غير قابلة للذوبان. هذه البلورات تعزل الألواح وتقتل سعة البطارية للأبد. الوقاية الوحيدة هي الشحن المستمر وعدم السماح للجهد بالنزول تحت 10.5 فولت.",
    visual: (stage: any) => <BatteryChemistryVisualizer stage="sulfation" />,
    tag: "تحليل الأعطال"
  },
  {
    id: 'short-circuit',
    title: "تشخيص الدائرة القصيرة (Short Circuit)",
    subtitle: "Internal Cell Failure",
    content: "تحدث الدائرة القصيرة عندما تلامس الألواح الموجبة والسالبة بعضها البعض داخل الخلية. ستلاحظ أن كثافة خلية واحدة منخفضة جداً عن البقية ولا ترتفع مهماً شحنت. الإصلاح: في البطاريات الحديثة يصعب إصلاحها يدوياً، ولكن يمكن أحياناً 'صعق' الخلية بجهد عالٍ جداً لفترة قصيرة جداً لتفتيت الرواسب، رغم خطورة ذلك.",
    visual: (stage: any) => <div className="h-48 bg-red-950 rounded-2xl flex items-center justify-center relative overflow-hidden">
        <motion.div animate={{ opacity: [0.1, 0.5, 0.1] }} transition={{ repeat: Infinity, duration: 1 }} className="absolute inset-0 bg-red-500" />
        <Zap size={48} className="text-white relative z-10" />
        <p className="absolute bottom-4 text-[8px] font-black text-white/40 uppercase">Internal Arc Detection Simulator</p>
    </div>,
    tag: "الأعطال الخطيرة"
  },
  {
    id: 'corrosion',
    title: "تآكل الشبكات (Grid Corrosion)",
    subtitle: "Structural Integrity Loss",
    content: "الحرارة العالية والشحن الزائد يؤديان لتأكسد شبكات الرصاص. هذا يزيد المقاومة الداخلية ويقلل قدرة البطارية على إعطاء تيار بدء التشغيل (CCA). الوقاية: الحفاظ على درجة حرارة أقل من 40 مئوية وضبط منظم الشحن (Alternator) بحيث لا يتجاوز 14.4 فولت.",
    visual: (stage: any) => <div className="h-48 bg-neutral-800 rounded-2xl p-6">
      <div className="grid grid-cols-4 gap-2 h-full">
        {[1,2,3,4,5,6,7,8].map(i => (
          <div key={i} className="bg-neutral-600 rounded relative overflow-hidden">
            <motion.div animate={{ height: ['0%', '80%'] }} transition={{ duration: 5, repeat: Infinity, delay: i * 0.2 }} className="absolute bottom-0 w-full bg-orange-900/60" />
          </div>
        ))}
      </div>
    </div>,
    tag: "تقادم البطارية"
  },
  {
    id: 'pulse-charging',
    title: "تقنية الشحن النبضي (Pulse Charging)",
    subtitle: "Advanced Restoration Technique",
    content: "لإعادة إحياء البطاريات التي تعاني من كبرتة خفيفة، يتم استخدام تيار متقطع بذبذبات عالية. هذه النبضات تقوم 'بدق' بلورات الكبريتات وإجبارها على العودة للحمض. إنها الطريقة الأمثل لاستعادة السعة المفقودة.",
    visual: (stage: any) => <div className="h-48 bg-blue-900 rounded-2xl flex items-center justify-center">
      <div className="flex gap-1 h-20 items-end">
        {[1,2,3,4,5,6,1,2,3,4,5,6].map((i, idx) => (
          <motion.div 
            key={idx}
            animate={{ height: ['20%', '100%', '20%'] }}
            transition={{ duration: 0.2, repeat: Infinity, delay: idx * 0.05 }}
            className="w-2 bg-blue-400 rounded-full"
          />
        ))}
      </div>
    </div>,
    tag: "تقنيات الإصلاح"
  },
  {
    id: 'active-material',
    title: "تساقط المادة الفعالة",
    subtitle: "Shedding of Active Material",
    content: "مع كثرة دورات الشحن والتفريغ العميق، تبدأ مادة ثاني أكسيد الرصاص في التساقط من الألواح وتتجمع في القاع. إذا وصلت الرواسب لمستوى الألواح، ستحدث دائرة قصيرة. ستعرف ذلك من لون الحمض الذي يصبح معتماً أو مائلاً للسواد.",
    visual: (stage: any) => <div className="h-48 bg-neutral-900 rounded-2xl relative">
       <div className="absolute inset-x-4 top-4 h-2 bg-neutral-700 rounded-full" />
       {[...Array(15)].map((_, i) => (
         <motion.div 
           key={i}
           initial={{ y: 20, x: Math.random() * 200 + 40, opacity: 0 }}
           animate={{ y: 150, opacity: [0, 1, 0] }}
           transition={{ duration: 2, repeat: Infinity, delay: i * 0.2 }}
           className="absolute w-2 h-2 bg-neutral-500 rounded-full"
         />
       ))}
       <motion.div className="absolute bottom-0 inset-x-0 h-10 bg-neutral-800" />
    </div>,
    tag: "تآكل داخلي"
  },
  {
    id: 'electrolyte-level',
    title: "إدارة مستوى المحلول",
    subtitle: "Electrolyte Maintenance",
    content: "انخفاض مستوى المحلول يكشف الألواح للهواء، مما يسبب جفافاً وتصلباً لا رجعة فيه (Oxidation). يجب ملء البطارية بالماء المقطر فقط حتى المستوى المحدد. تحذير: لا تضف الحمض أبداً إلا إذا انسكب المحلول الأصلي فعلياً، لأن إضافة الحمض لبطارية مشحونة سيرفع الكثافة لمستويات قاتلة للألواح.",
    visual: (stage: any) => <div className="h-48 bg-blue-900 rounded-2xl flex flex-col items-center justify-center gap-4">
      <div className="w-24 h-32 border-2 border-white/20 rounded-lg relative overflow-hidden">
        <motion.div 
          animate={{ height: ['40%', '80%', '40%'] }} 
          transition={{ duration: 4, repeat: Infinity }}
          className="absolute bottom-0 w-full bg-blue-400/60"
        />
        <div className="absolute top-1/2 w-full h-0.5 bg-red-500/50 dashed" />
      </div>
      <p className="text-[10px] text-white/60 font-black">MIN/MAX LEVEL CALIBRATION</p>
    </div>,
    tag: "الصيانة الدورية"
  },
  {
    id: 'thermal-runaway',
    title: "الهروب الحراري (Thermal Runaway)",
    subtitle: "Catastrophic Overheating",
    content: "يحدث عندما ترتفع حرارة البطارية لدرجة تجعلها تسحب تياراً أكبر، مما يرفع الحرارة أكثر في حلقة مفرغة حتى تذوب البطارية أو تتفجر. الأسباب: شحن بجهد عالٍ في بيئة حارة، أو وجود خلية تالفة (Short Cell). إذا شعرت بحرارة تتجاوز 50 درجة، افصل الشحن فوراً واتركها تبرد في مكان مفتوح.",
    visual: (stage: any) => <div className="h-48 bg-red-900 rounded-2xl flex items-center justify-center">
      <motion.div 
        animate={{ scale: [1, 1.2, 1], opacity: [0.5, 1, 0.5] }}
        transition={{ duration: 1, repeat: Infinity }}
        className="w-24 h-24 bg-orange-500 rounded-full blur-2xl"
      />
      <AlertTriangle size={48} className="text-white relative z-10 animate-bounce" />
    </div>,
    tag: "الأمن والسلامة"
  },
  {
    id: 'separator-breach',
    title: "تمزق الفواصل الداخلية",
    subtitle: "Separator Degradation",
    content: "الفواصل هي الأغشية التي تمنع تلامس الألواح. مع الزمن والحرارة، قد تتمزق أو تتفتت، مما يسبب التفريغ الذاتي السريع. ستلاحظ أن البطارية تفقد شحنها خلال ساعات حتى لو لم تكن متصلة بأي حمل. لا يمكن إصلاح هذا العطل يدوياً.",
    visual: (stage: any) => <div className="h-48 bg-neutral-800 rounded-2xl flex items-center justify-center gap-2">
      <div className="w-1 bg-white/20 h-32" />
      <motion.div animate={{ opacity: [1, 0, 1] }} className="w-1 bg-brand-red h-32" />
      <div className="w-1 bg-white/20 h-32" />
    </div>,
    tag: "أعطال هيكلية"
  },
  {
    id: 'plate-colors',
    title: "تشخيص ألوان الألواح",
    subtitle: "Visual Plate Diagnosis",
    content: "لون اللوح يخبرك بقصة البطارية. اللون البني الشوكولاتي الداكن للألواح الموجبة واللون الرمادي للألواح السالبة يعني صحة ممتازة. اللون الأبيض هو علامة الكبرتة، أما اللون الأسود القاتم جداً فهو دليل على الشحن الزائد وتآكل المادة الفعالة.",
    visual: (stage: any) => <div className="h-48 bg-neutral-900 rounded-2xl flex gap-4 p-8">
      <div className="flex-1 bg-[#4a2c2a] rounded shadow-lg border border-white/10 flex items-center justify-center text-[10px] text-white/40 rotate-1">Positive (Healthy)</div>
      <div className="flex-1 bg-[#808080] rounded shadow-lg border border-white/10 flex items-center justify-center text-[10px] text-white/40 -rotate-1">Negative (Healthy)</div>
    </div>,
    tag: "التفتيش البصري"
  },
  {
    id: 'terminal-repair',
    title: "إصلاح الأقطاب المتآكلة",
    subtitle: "Post & Terminal Restoration",
    content: "الأملاح البيضاء (كبريتات الرصاص) حول الأقطاب تسبب مقاومة عالية وتمنع الشحن. العلاج: تنظيف بماء ساخن وبيكربونات الصوديوم، ثم صنفرة خفيفة، وأخيراً تغطية القطب بطبقة رقيقة من الفازلين أو شحم خاص لمنع الأكسدة مستقبلاً.",
    visual: (stage: any) => <div className="h-48 bg-neutral-800 rounded-2xl flex items-center justify-center relative">
      <motion.div 
        animate={{ scale: [1, 0] }}
        transition={{ duration: 4, repeat: Infinity }}
        className="absolute w-32 h-32 bg-white/40 blur-3xl"
      />
      <div className="w-12 h-12 bg-neutral-400 rounded-t-lg relative z-10 shadow-2xl">
         <div className="absolute top-0 left-0 right-0 h-2 bg-neutral-300 rounded-t-lg" />
      </div>
    </div>,
    tag: "خطوات الإصلاح"
  },
  {
    id: 'ventilation',
    title: "إدارة الغازات والانفجار",
    subtitle: "Hydrogen Outgassing",
    content: "أثناء الشحن، تطلق البطارية غاز الهيدروجين وهو سريع الاشتعال جداً. أي شرارة ناتجة عن توصيل الأسلاك أو التدخين قد تسبب انفجاراً يمزق غلاف البطارية وينثر الحمض. تأكد من أن فتحات التهوية نظيفة وأن مكان العمل جيد التهوية. استخدم نظارات الحماية دائماً.",
    visual: (stage: any) => <div className="h-48 bg-neutral-800 rounded-2xl overflow-hidden relative">
      {[...Array(10)].map((_, i) => (
        <motion.div 
          key={i}
          initial={{ y: 200, x: Math.random() * 200 + 40 }}
          animate={{ y: -50, opacity: [0, 1, 0] }}
          transition={{ duration: 3, repeat: Infinity, delay: i * 0.3 }}
          className="absolute w-4 h-4 rounded-full border border-white/20"
        />
      ))}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="text-[10px] font-black text-white/20 rotate-12">H2 GAS DISCHARGE MGMT</div>
      </div>
    </div>,
    tag: "بيئة العمل"
  },
  {
    id: 'storage',
    title: "دليل التخزين الطويل",
    subtitle: "Storage Best Practices",
    content: "إذا كنت ستخزن البطارية لفترة طويلة: 1. اشحنها بالكامل 100%. 2. افصل الكابلات لمنع التفريغ الطفيلي. 3. خزنها في مكان بارد وجاف (البرودة تقلل التفريغ الذاتي). 4. أعد شحنها كل 3 أشهر للحفاظ على مستوى الكثافة وتجنب الكبرتة.",
    visual: (stage: any) => <div className="h-48 bg-neutral-900 rounded-2xl flex items-center justify-center text-white/20">
      <div className="text-center">
        <History size={48} className="mx-auto mb-2 opacity-20" />
        <p className="text-[10px] font-mono">12-WEEK MAINTENANCE CYCLE</p>
      </div>
    </div>,
    tag: "إدارة المخزون"
  },
  {
    id: 'equalization',
    title: "شحن التعادل (Equalization)",
    subtitle: "Balancing the Cells",
    content: "شحن التعادل هو شحن زائد متعمد (بجهد 15.5-16 فولت) لبطاريات الرصاص المغمورة. يهدف لتحريك الحمض الراكد وموازنة جهد الخلايا. يجب مراقبة الحرارة بدقة وتعويض الماء المفقود بعد العملية. لا ينصح به لبطاريات الجل (Gel) أو AGM.",
    visual: (stage: any) => <div className="h-48 bg-purple-900 rounded-2xl flex items-center justify-center gap-2">
      {[1,1.1,1.2,1,0.9,1.1].map((s, i) => (
        <motion.div 
          key={i}
          animate={{ height: ['40%', '80%', '40%'] }}
          transition={{ duration: 1, repeat: Infinity, delay: i * 0.1 }}
          className="w-4 bg-purple-400 rounded-full"
        />
      ))}
    </div>,
    tag: "صيانة متقدمة"
  },
  {
    id: 'desulfation-machine',
    title: "أجهزة تفتيت الكبرتة الاحترافية",
    subtitle: "RF Desulfation Technology",
    content: "تستخدم الورش الاحترافية أجهزة ترسل نبضات كهرومغناطيسية بتردد الرنين لبلورات كبريتات الرصاص (حوالي 2-6 ميجاهرتز). هذه النبضات تفتت البلورات الكبيرة التي لا يستطيع الشاحن العادي إذابتها. لا تحاول صنع جهازك الخاص بدون خبرة إلكترونية، فقد يسبب انفجار الخلية.",
    visual: (stage: any) => <div className="h-48 bg-neutral-900 rounded-2xl flex items-center justify-center relative overflow-hidden">
      <motion.div animate={{ opacity: [0.1, 0.3, 0.1], scale: [1, 2] }} transition={{ duration: 0.5, repeat: Infinity }} className="absolute inset-0 bg-blue-500 rounded-full blur-3xl" />
      <div className="z-10 text-white font-mono text-[10px] space-y-1">
        <p>RESONANCE: 3.26 MHz</p>
        <p>PULSE: 80A / 10μs</p>
      </div>
    </div>,
    tag: "معدات الورش"
  },
  {
    id: 'cell-reversal',
    title: "عكس قطبية الخلية",
    subtitle: "Cell Polarity Reversal",
    content: "يحدث عندما يتم تفريغ البطارية لدرجة الصفر المطلق، فتبدأ أضعف خلية في شحن نفسها بقطبية معكوسة من بقية الخلايا. هذا يدمر الخلية فوراً. الموت المفاجئ للبطارية غالباً ما يكون سببه خلية واحدة معكوسة. الحل: استبدال البطارية، حيث لا يمكن 'عدل' القطبية كيميائياً مرة أخرى.",
    visual: (stage: any) => <div className="h-48 bg-neutral-900 rounded-2xl flex items-center justify-center gap-1">
      {[1,1,1,-1,1,1].map((p, i) => (
        <div key={i} className={`w-6 h-16 rounded flex items-center justify-center font-black text-xs ${p === 1 ? 'bg-blue-500' : 'bg-red-600 animate-pulse ring-4 ring-red-500/50'}`}>
          {p === 1 ? '+' : '-'}
        </div>
      ))}
    </div>,
    tag: "حالات حرجة"
  },
  {
    id: 'internal-resistance',
    title: "المقاومة الداخلية وSTART-STOP",
    subtitle: "Internal Resistance (ESR)",
    content: "البطاريات القديمة يرتفع فيها ESR (المقاومة الداخلية). حتى لو كان الجهد 12.6 فولت، لا تستطيع البطارية إعطاء تيار عالي للتشغيل. في أنظمة Start-Stop، الحساس الذكي (IBS) يراقب هذه المقاومة بدقة. تنظيف الأقطاب وتقليل الأحمال الطفيلية يساعد في تقليل المقاومة الظاهرية.",
    visual: (stage: any) => <div className="h-48 bg-neutral-800 rounded-2xl flex items-center justify-center">
       <div className="relative">
         <motion.div animate={{ rotate: [0, 360] }} transition={{ duration: 10, repeat: Infinity, ease: "linear" }} className="w-24 h-24 border-4 border-dashed border-white/10 rounded-full" />
         <div className="absolute inset-0 flex items-center justify-center text-white font-black text-xl">0.08Ω</div>
       </div>
    </div>,
    tag: "أنظمة حديثة"
  }
];

const getSmartRecommendation = (section: string, density: string, temp: string) => {
  const corrected = parseFloat(calculateCorrectedDensity(density, temp) || '0');
  const t = parseFloat(temp);
  
  if (t > 45) return { type: 'danger', icon: <AlertTriangle size={14} />, text: 'حرارة مرتفعة جداً! خطر الغليان والتبخر. أوقف الشحن فوراً.', researchId: 'chemistry' };
  
  if (!corrected) return null;

  switch(section) {
    case 'fillingAcid':
      if (corrected < 1.240) return { type: 'warning', icon: <Info size={14} />, text: 'الكثافة منخفضة للملئ. البطارية قد لا تصل لكامل كفاءتها.', researchId: 'chemistry' };
      if (corrected > 1.270) return { type: 'warning', icon: <Info size={14} />, text: 'كثافة عالية! قد تسبب تآكل الألواح مستقبلاً.', researchId: 'stratification' };
      return { type: 'success', icon: <Check size={14} />, text: 'كثافة ملئ نموذجية (1.250-1.260).', researchId: 'chemistry' };
    case 'afterCharging':
      if (corrected < 1.260) return { type: 'warning', icon: <Zap size={14} />, text: 'الشحن لم يكتمل. استمر في الشحن حتى تثبت الكثافة.', researchId: 'sulfation' };
      return { type: 'success', icon: <CheckCircle2 size={14} />, text: 'البطارية مشحونة بنجاح. جاهزة للاستخدام.', researchId: 'chemistry' };
    case 'levelAdjustment':
      if (corrected > 1.300) return { type: 'danger', icon: <AlertTriangle size={14} />, text: 'حمض مركز جداً! أضف الماء المقطر لتفادي تلف الألواح.', researchId: 'stratification' };
      return { type: 'info', icon: <Droplets size={14} />, text: 'ضبط المستوى يضمن توزيعاً عادلاً للجهد بين الخلايا.', researchId: 'discharge' };
    default:
      return null;
  }
};

function RecommendationBox({ section, density, temp, onLearnMore }: { section: string, density: string, temp: string, onLearnMore: (id: string) => void }) {
  const recommendation = getSmartRecommendation(section, density, temp);
  
  if (!recommendation) return null;

  return (
    <motion.div 
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      className={`mt-4 overflow-hidden rounded-2xl border transition-all ${
        recommendation.type === 'danger' ? 'bg-red-50 border-red-100' :
        recommendation.type === 'warning' ? 'bg-amber-50 border-amber-100' :
        recommendation.type === 'success' ? 'bg-emerald-50 border-emerald-100' :
        'bg-blue-50 border-blue-100'
      }`}
    >
      <div className="p-4 flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <div className="mt-0.5">{recommendation.icon}</div>
          <p className="text-xs font-bold leading-relaxed text-right">{recommendation.text}</p>
        </div>
        {recommendation.researchId && (
          <button 
            onClick={() => onLearnMore(recommendation.researchId!)}
            className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-neutral-600 hover:text-neutral-900 transition-colors w-fit group self-start"
          >
            <span>العلم وراء ذلك</span>
            <ChevronLeft size={12} className="group-hover:-translate-x-1 transition-transform rotate-180" />
          </button>
        )}
      </div>
    </motion.div>
  );
}

// Professional Chemical Process Visualization
function BatteryChemistryVisualizer({ stage }: { stage: 'charge' | 'discharge' | 'sulfation' }) {
  return (
    <div className="relative w-full h-48 bg-neutral-900 rounded-2xl overflow-hidden border border-white/5 shadow-2xl">
      {/* Liquid Electrolyte */}
      <motion.div 
        animate={{ 
          y: stage === 'charge' ? [-2, 2, -2] : [0, 0],
          opacity: stage === 'sulfation' ? 0.3 : 0.6
        }}
        transition={{ duration: 4, repeat: Infinity }}
        className="absolute inset-0 bg-blue-500/20" 
      />
      
      {/* Plate: Anode (Negative) */}
      <div className="absolute left-10 top-10 bottom-10 w-4 bg-neutral-600 rounded-full flex flex-col items-center justify-center gap-1 shadow-[0_0_15px_rgba(0,0,0,0.5)]">
         <span className="text-[8px] font-black text-white/40 -rotate-90">ANODE (-Pb)</span>
         {stage === 'sulfation' && (
           <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="absolute inset-0 bg-white/20 blur-sm rounded-full" />
         )}
      </div>

      {/* Plate: Cathode (Positive) */}
      <div className="absolute right-10 top-10 bottom-10 w-4 bg-neutral-400 rounded-full flex flex-col items-center justify-center gap-1 shadow-[0_0_15px_rgba(0,0,0,0.5)]">
        <span className="text-[8px] font-black text-black/40 -rotate-90">CATHODE (+PbO2)</span>
      </div>

      {/* Ion Movement Simulator */}
      <div className="absolute inset-0 pointer-events-none">
        {[...Array(8)].map((_, i) => (
          <motion.div
            key={i}
            initial={{ x: Math.random() * 200 + 50, y: Math.random() * 100 + 40 }}
            animate={{ 
              x: stage === 'charge' ? [300, 100] : stage === 'discharge' ? [100, 300] : [150, 160, 150],
              y: stage === 'sulfation' ? [50, 50] : [40, 120, 40]
            }}
            transition={{ 
              duration: stage === 'sulfation' ? 10 : 3, 
              repeat: Infinity, 
              delay: i * 0.4,
              ease: "easeInOut"
            }}
            className={`absolute w-1.5 h-1.5 rounded-full blur-[1px] ${i % 2 === 0 ? 'bg-blue-400 shadow-[0_0_8px_#60a5fa]' : 'bg-red-400 shadow-[0_0_8px_#f87171]'}`}
          />
        ))}
      </div>

      {/* Action Text */}
      <div className="absolute bottom-4 left-0 right-0 text-center">
        <div className="inline-block px-3 py-1 bg-white/5 backdrop-blur-md rounded-full border border-white/10">
          <span className="text-[8px] font-black text-white/50 uppercase tracking-[0.3em]">
            {stage === 'charge' ? 'Electron Flow: Active Charging' : stage === 'discharge' ? 'Energy Release: Discharging' : 'Crystalline Growth: Sulfation'}
          </span>
        </div>
      </div>
    </div>
  );
}

function ResearchBook({ initialPageId, onClose }: { initialPageId?: string, onClose?: () => void }) {
  const initialPageIndex = initialPageId ? RESEARCH_PAGES.findIndex(p => p.id === initialPageId) : 0;
  const [activePage, setActivePage] = useState(initialPageIndex === -1 ? 0 : initialPageIndex);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  
  useEffect(() => {
    if (initialPageId) {
      const idx = RESEARCH_PAGES.findIndex(p => p.id === initialPageId);
      if (idx !== -1) setActivePage(idx);
    }
  }, [initialPageId]);

  const page = RESEARCH_PAGES[activePage];

  const filteredResults = RESEARCH_PAGES.filter(p => 
    p.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
    p.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.tag.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="bg-white rounded-3xl overflow-hidden shadow-2xl border border-neutral-100 flex flex-col h-full max-h-[85vh]">
      <div className="bg-neutral-900 p-8 text-white relative shrink-0">
        <div className="absolute top-0 right-0 opacity-10 pointer-events-none">
          <BookOpen size={200} />
        </div>
        <div className="relative z-10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-brand-red flex items-center justify-center shadow-lg shadow-brand-red/40">
              <BookOpen size={20} />
            </div>
            <div>
              <h3 className="text-xl font-black tracking-tight">{page.title}</h3>
              <p className="text-[10px] font-mono text-white/50 uppercase tracking-widest">{page.subtitle}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={() => setShowSearch(!showSearch)}
              className={`p-3 rounded-full transition-all active:scale-95 ${showSearch ? 'bg-brand-red text-white' : 'bg-white/10 text-white hover:bg-white/20'}`}
            >
              <Search size={24} />
            </button>
            {onClose && (
              <button 
                onClick={onClose}
                className="p-3 bg-white/10 hover:bg-brand-red rounded-full transition-all active:scale-95"
              >
                <ChevronLeft size={24} className="rotate-180" />
              </button>
            )}
          </div>
        </div>

        <AnimatePresence>
          {showSearch && (
            <motion.div 
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="relative mt-6"
            >
              <input 
                type="text"
                placeholder="ابحث في الموسوعة (أعطال، إصلاح، كيمياء...)"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoFocus
                className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-sm font-bold text-white placeholder:text-white/30 focus:outline-none focus:border-brand-red focus:ring-4 focus:ring-brand-red/20 transition-all text-right"
              />
              {searchQuery && (
                <div className="absolute top-full left-0 right-0 mt-2 bg-neutral-800 border border-white/10 rounded-xl max-h-48 overflow-y-auto shadow-2xl z-50">
                  {filteredResults.length > 0 ? (
                    filteredResults.map((result) => (
                      <button
                        key={result.id}
                        onClick={() => {
                          const idx = RESEARCH_PAGES.findIndex(p => p.id === result.id);
                          setActivePage(idx);
                          setSearchQuery('');
                          setShowSearch(false);
                        }}
                        className="w-full px-4 py-3 text-right hover:bg-white/5 border-b border-white/5 last:border-0 flex items-center justify-between group"
                      >
                        <span className="text-[8px] font-black opacity-30 uppercase">{result.tag}</span>
                        <span className="text-xs font-bold text-white group-hover:text-brand-red transition-colors">{result.title}</span>
                      </button>
                    ))
                  ) : (
                    <p className="p-4 text-center text-xs text-white/40">لا توجد نتائج للبحث</p>
                  )}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="flex-1 p-8 overflow-y-auto space-y-8 bg-neutral-50/30">
        <AnimatePresence mode="wait">
          <motion.div
            key={page.id}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="space-y-8"
          >
            <div className="flex items-center gap-2">
               <span className="px-2 py-0.5 bg-brand-red/10 text-brand-red text-[8px] font-black rounded uppercase">{page.tag}</span>
               <div className="h-[1px] flex-1 bg-neutral-200" />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
              <div className="space-y-6">
                <p className="text-neutral-600 font-medium leading-relaxed text-sm text-right leading-loose bg-white p-6 rounded-2xl border border-neutral-100 shadow-sm transition-all hover:shadow-md">
                  {page.content}
                </p>
                <div className="flex gap-3">
                  <button className="flex-1 py-3 bg-neutral-900 text-white text-[10px] font-black rounded-xl shadow-xl uppercase tracking-widest hover:bg-black transition-all">تحديد كأهمية قصوى</button>
                  <button className="flex-1 py-3 border-2 border-neutral-200 text-neutral-600 text-[10px] font-black rounded-xl uppercase tracking-widest hover:border-neutral-400 transition-all">المصادر العلمية</button>
                </div>
              </div>
              <div className="p-2 bg-neutral-900 rounded-3xl shadow-inner border-[10px] border-neutral-800">
                {page.visual(null)}
              </div>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="p-6 bg-white border-t border-neutral-100 flex items-center justify-between shrink-0">
        <button 
          disabled={activePage === 0}
          onClick={() => setActivePage(p => p - 1)}
          className="flex items-center gap-2 text-xs font-black text-neutral-400 hover:text-neutral-800 disabled:opacity-20 transition-all uppercase tracking-widest"
        >
          <ChevronRight size={20} /> الصفحة السابقة
        </button>
        <div className="flex gap-1.5">
          {RESEARCH_PAGES.map((_, i) => (
            <button 
              key={i} 
              onClick={() => setActivePage(i)}
              className={`h-2 rounded-full transition-all ${i === activePage ? 'w-10 bg-brand-red shadow-[0_0_10px_rgba(239,68,68,0.4)]' : 'w-2 bg-neutral-200 hover:bg-neutral-300'}`} 
            />
          ))}
        </div>
        <button 
          disabled={activePage === RESEARCH_PAGES.length - 1}
          onClick={() => setActivePage(p => p + 1)}
          className="flex items-center gap-2 text-xs font-black text-neutral-400 hover:text-neutral-800 disabled:opacity-20 transition-all uppercase tracking-widest"
        >
          الصفحة التالية <ChevronLeft size={20} />
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const [data, setData] = useState<ReportData>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : INITIAL_STATE;
  });
  const [previewText, setPreviewText] = useState('');
  const [copied, setCopied] = useState(false);
  const [validated, setValidated] = useState(false);
  const [batteryCode, setBatteryCode] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [isFlashOn, setIsFlashOn] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [shutterEffect, setShutterEffect] = useState(false);
  const [researchPageId, setResearchPageId] = useState<string | null>(null);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [html5QrCodeInstance, setHtml5QrCodeInstance] = useState<Html5Qrcode | null>(null);
  const [isAutoAnalyzing, setIsAutoAnalyzing] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [maxZoom, setMaxZoom] = useState(1);
  const [minZoom, setMinZoom] = useState(1);
  const [hasZoom, setHasZoom] = useState(false);
  const [brightness, setBrightness] = useState<number>(0);
  const [isTooDark, setIsTooDark] = useState(false);
  const [isTooBright, setIsTooBright] = useState(false);

  const decodedData = decodeBatteryCode(batteryCode);
  const ocrTimerRef = React.useRef<NodeJS.Timeout | null>(null);

  // Analyze lighting from video stream
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isScanning) {
      interval = setInterval(() => {
        const video = document.querySelector('video');
        if (!video) return;

        const canvas = document.createElement('canvas');
        canvas.width = 100;
        canvas.height = 100;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.drawImage(video, 0, 0, 100, 100);
        const data = ctx.getImageData(0, 0, 100, 100).data;
        let totalBrightness = 0;
        for (let i = 0; i < data.length; i += 4) {
          totalBrightness += (data[i] + data[i + 1] + data[i + 2]) / 3;
        }
        const avgBrightness = totalBrightness / (100 * 100);
        setBrightness(avgBrightness);
        setIsTooDark(avgBrightness < 40);
        setIsTooBright(avgBrightness > 220);
      }, 500);
    }
    return () => clearInterval(interval);
  }, [isScanning]);
  const isOcrProcessingRef = React.useRef(false);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }, [data]);

  const generateReportText = useCallback((reportData: ReportData) => {
    const lines: string[] = [];

    if (reportData.fillingAcid.enabled) {
      lines.push(`• كثافة حمض الملئ ${reportData.fillingAcid.density || '...'} عند درجة حرارة ${reportData.fillingAcid.temp || '...'} في طراز ${reportData.fillingAcid.model || '...'}`);
    }

    lines.push(`• كثافة حمض البطارية بعد الشحن ${reportData.afterCharging.density || '...'} عند درجة حرارة ${reportData.afterCharging.temp || '...'} في طراز ${reportData.afterCharging.model || '...'}`);
    
    lines.push(`• كثافة حمض ضبط المستوى ${reportData.levelAdjustment.density || '...'} درجة حرارة ${reportData.levelAdjustment.temp || '...'}`);
    
    lines.push(`• كثافه البطاريه ${reportData.generalDensity.density || '...'} درجة الحراره ${reportData.generalDensity.temp || '...'} فى طراز ${reportData.generalDensity.model || '...'}`);

    return lines.join('\n');
  }, []);

  const handleClear = () => {
    if (window.confirm('هل أنت متأكد من مسح جميع البيانات؟')) {
      setData(INITIAL_STATE);
      localStorage.removeItem(STORAGE_KEY);
    }
  };

  useEffect(() => {
    setPreviewText(generateReportText(data));
    const isBasicReady = 
      data.afterCharging.density && data.afterCharging.model &&
      data.generalDensity.density && data.generalDensity.model;
    setValidated(!!isBasicReady);
  }, [data, generateReportText]);

  const handleUpdate = (section: keyof ReportData, field: string, value: any) => {
    setData(prev => ({
      ...prev,
      [section]: {
        ...(prev[section] as any),
        [field]: value
      }
    }));
  };

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(previewText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy!', err);
    }
  };

  const sendToWhatsApp = () => {
    if (!validated) {
      alert('يرجى ملء البيانات الأساسية أولاً (بعد الشحن والكثافة العامة)');
      return;
    }
    const encodedText = encodeURIComponent(previewText);
    window.open(`https://wa.me/?text=${encodedText}`, '_blank');
  };

  const handleManualOCR = async (source: string | HTMLCanvasElement | File, silent = false) => {
    if (!silent) setIsProcessing(true);
    if (silent) setIsAutoAnalyzing(true);
    
    try {
      // 1. Try local OCR with Tesseract
      const ocrResult = await Tesseract.recognize(
        source as any,
        'eng',
        { 
          logger: m => {},
          errorHandler: e => console.error("Tesseract internal error:", e)
        }
      );
      
      let rawText = ocrResult.data.text.toUpperCase();
      let lines = rawText.split('\n').map(l => l.trim().replace(/\s/g, ''));
      
      const patterns = [
        /\d+P[A-Z][A-Z]\d+[A-Z]\d+[A-Z]/,
        /\d+P[A-Z0-9]{8,15}/,
        /[A-Z0-9]{12}/,
        /[A-Z0-9]{10,18}/
      ];

      const findCodeInLines = (textLines: string[]) => {
        for (const line of textLines) {
           // Try fuzzy decode first for standard format
           const fuzzyRes = fuzzyDecode(line);
           if (fuzzyRes) return fuzzyRes.rawMatch;

          for (const pattern of patterns) {
            const foundMatch = line.match(pattern);
            if (foundMatch) return foundMatch[0];
          }
        }
        return null;
      };

      let detectedCode = findCodeInLines(lines);

      // 2. If Tesseract fails, or we want high precision, call Gemini AI
      if (!detectedCode && !silent) {
        console.log("Local OCR failed, escalation to Neural AI...");
        const canvas = source instanceof HTMLCanvasElement ? source : null;
        if (canvas) {
          const base64 = canvas.toDataURL('image/jpeg', 0.8);
          const aiResult = await processImageWithAI(base64, OCR_PROMPT);
          if (aiResult) {
            // Apply fuzzy correction even to AI results
            const cleanAiResult = aiResult.trim().replace(/\s/g, '');
            const fuzzyAi = fuzzyDecode(cleanAiResult);
            detectedCode = fuzzyAi ? fuzzyAi.rawMatch : cleanAiResult;
            console.log("AI Detected Code:", detectedCode);
          }
        }
      }

      if (detectedCode) {
        setBatteryCode(detectedCode);
        setScannerError(null);
        return true;
      }

      return false;
    } catch (err) {
      console.error("OCR Error:", err);
      return false;
    } finally {
      if (!silent) setIsProcessing(false);
      setIsAutoAnalyzing(false);
    }
  };

  // Helper for pixel-level image processing
  const applyAdvancedFilters = (canvas: HTMLCanvasElement) => {
    preprocessForOCR(canvas);
  };

  const captureAndOCR = async (silent = false) => {
    if (isOcrProcessingRef.current) return;
    
    const video = document.querySelector('#reader video') as HTMLVideoElement;
    if (!video) return;

    isOcrProcessingRef.current = true;
    if (!silent) {
      setIsProcessing(true);
      setShutterEffect(true);
      setTimeout(() => setShutterEffect(false), 150);
    }
    setScannerError(null);

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    
    if (!ctx) {
      if (!silent) setIsProcessing(false);
      isOcrProcessingRef.current = false;
      return;
    }

    // AI Deep Scanning Multi-Strategy Array
    const strategies = [
      { name: 'Ultra Sharp 3x', zoom: 3.0, xOffset: 0.5, yOffset: 0.5, filters: 'grayscale(1) contrast(3) brightness(1.2) saturate(0)' },
      { name: 'Wide Scan 1.5x', zoom: 1.5, xOffset: 0.5, yOffset: 0.5, filters: 'grayscale(1) contrast(2) brightness(1.1)' },
      { name: 'Macro Detail 5x', zoom: 5.0, xOffset: 0.5, yOffset: 0.5, filters: 'grayscale(1) contrast(4) brightness(1.3)' },
      { name: 'Top Horizon', zoom: 2.0, xOffset: 0.5, yOffset: 0.3, filters: 'grayscale(1) contrast(2)' },
      { name: 'Bottom Horizon', zoom: 2.0, xOffset: 0.5, yOffset: 0.7, filters: 'grayscale(1) contrast(2)' }
    ];

    let success = false;
    for (const strategy of strategies) {
      // High-res target for OCR
      const targetWidth = 1600;
      const targetHeight = 1600 / (video.videoWidth / video.videoHeight);
      canvas.width = targetWidth;
      canvas.height = targetHeight;

      const z = strategy.zoom;
      const sw = video.videoWidth / z;
      const sh = video.videoHeight / z;
      
      const sx = Math.max(0, Math.min(video.videoWidth - sw, (video.videoWidth * strategy.xOffset) - (sw / 2)));
      const sy = Math.max(0, Math.min(video.videoHeight - sh, (video.videoHeight * strategy.yOffset) - (sh / 2)));

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      ctx.filter = strategy.filters;
      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      ctx.filter = 'none';

      applyAdvancedFilters(canvas);
      
      const ocrSuccess = await handleManualOCR(canvas, silent);
      if (ocrSuccess) {
        success = true;
        setIsScanning(false);
        setIsFlashOn(false);
        break;
      }
    }

    // Last Resort: Send raw high-res frame to Gemini for holistic analysis
    if (!success && !silent) {
      console.log("Multi-strategy local OCR failed. Final Neural Vision check...");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      const base64 = canvas.toDataURL('image/jpeg', 0.9);
      const finalCode = await processImageWithAI(base64, OCR_PROMPT);
      if (finalCode && finalCode.length > 5) {
        const cleanedCode = finalCode.replace(/[^A-Z0-9]/g, '');
        setBatteryCode(cleanedCode);
        success = true;
        setIsScanning(false);
        setIsFlashOn(false);
      }
    }

    // Auto-Flash Strategy: If it was dark or all failed, try with flash once
    if (!success && !silent && !isFlashOn) {
      console.log("Low light or poor scan detected. Activating auto-flash and retrying...");
      await toggleFlash();
      // Wait for flash to stabilize
      await new Promise(r => setTimeout(r, 500));
      // Recursive call with flash on, then turn it off
      const flashSuccess = await captureAndOCR(silent);
      if (flashSuccess) return true;
    }
    
    if (!silent) setIsProcessing(false);
    isOcrProcessingRef.current = false;
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    setScannerError(null);
    try {
      const htmlScanner = new Html5Qrcode("reader-hidden");
      const tryScan = async (imageSource: File | string) => {
        try { return await htmlScanner.scanFile(imageSource as any, false); } catch (e) { return null; }
      };

      // 1. Try raw scan
      let result = await tryScan(file);
      
      // 2. If raw scan fails, try AI enhancement strategies
      if (!result) {
        const img = new Image();
        const objectUrl = URL.createObjectURL(file);
        
        await new Promise((resolve) => { img.onload = resolve; img.src = objectUrl; });
        
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        
        if (ctx) {
          const strategies = [
            { filter: 'grayscale(1) contrast(2) brightness(1.1)', zoom: 1.0 },
            { filter: 'grayscale(1) contrast(3) brightness(1.2)', zoom: 1.5 },
            { filter: 'invert(1) grayscale(1) contrast(2)', zoom: 1.0 },
            { filter: 'grayscale(1) contrast(1.5) brightness(1.1)', zoom: 2.0 }
          ];

          for (const strategy of strategies) {
            canvas.width = img.width * strategy.zoom;
            canvas.height = img.height * strategy.zoom;
            ctx.filter = strategy.filter;
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            ctx.filter = 'none';

            // Apply deep pixel analysis for uploaded images
            applyAdvancedFilters(canvas);
            
            const ocrSuccess = await handleManualOCR(canvas, true);
            if (ocrSuccess) {
              result = "OCR_SUCCESS"; // Flag to stop
              break;
            }

            // Also try QR scan on processed
            const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
            result = await tryScan(dataUrl);
            if (result) break;
          }
        }
        URL.revokeObjectURL(objectUrl);
      }

      if (result) {
        if (result !== "OCR_SUCCESS") setBatteryCode(result);
      } else {
        const finalOcrSuccess = await handleManualOCR(file);
        if (!finalOcrSuccess) throw new Error("Decoding failed");
      }
      
      htmlScanner.clear();
    } catch (err) {
      console.error("Upload AI Analysis error:", err);
      setScannerError("تعذر تحليل الصورة المرفوعة. يرجى التأكد من وضوح الكود أو إدخاله يدوياً.");
    } finally {
      setIsProcessing(false);
    }
    e.target.value = '';
  };

  const toggleScanner = async () => {
    setIsScanning(!isScanning);
  };

  const toggleFlash = async () => {
    if (!html5QrCodeInstance || !isScanning) return;
    try {
      const newState = !isFlashOn;
      await html5QrCodeInstance.applyVideoConstraints({
        advanced: [{ torch: newState }] as any
      });
      setIsFlashOn(newState);
    } catch (err) {
      console.error("Flash error:", err);
    }
  };

  const handleZoomChange = async (value: number) => {
    if (!html5QrCodeInstance || !isScanning) return;
    setZoomLevel(value);
    try {
      await html5QrCodeInstance.applyVideoConstraints({
        advanced: [{ zoom: value }] as any
      });
    } catch (err) {
      console.error("Zoom apply error:", err);
    }
  };

  useEffect(() => {
    let html5QrCode: Html5Qrcode | null = null;
    let isMounted = true;
    let analysisTimeout: NodeJS.Timeout | null = null;
    
    if (isScanning) {
      setScannerError(null);
      const startScanner = async () => {
        try {
          // Wait for DOM element and a small settling period
          let attempts = 0;
          while (!document.getElementById("reader") && attempts < 30 && isMounted) {
            await new Promise(r => setTimeout(r, 150));
            attempts++;
          }

          if (!isMounted || !document.getElementById("reader")) return;

          html5QrCode = new Html5Qrcode("reader");
          setHtml5QrCodeInstance(html5QrCode);
          
          const config = { 
            fps: 24, 
            qrbox: (viewfinderWidth: number, viewfinderHeight: number) => ({
              width: Math.min(viewfinderWidth * 0.95, 600),
              height: Math.min(viewfinderHeight * 0.6, 350)
            }),
            videoConstraints: {
              facingMode: "environment",
              width: { ideal: 1280 },
              height: { ideal: 720 }
            }
          };
          
          try {
            await html5QrCode.start(
              { facingMode: "environment" },
              config,
              (decodedText) => {
                const fuzzyResult = fuzzyDecode(decodedText);
                if (fuzzyResult || decodedText.length > 5) {
                  setBatteryCode(fuzzyResult?.rawMatch || decodedText);
                  setIsScanning(false);
                  setIsFlashOn(false);
                }
              },
              () => {}
            );
          } catch (firstErr) {
            console.warn("Environment camera failed, trying default...", firstErr);
            // Fallback to any camera
            await html5QrCode.start(
              { facingMode: "user" },
              config,
              (decodedText) => {
                const fuzzyResult = fuzzyDecode(decodedText);
                if (fuzzyResult || decodedText.length > 5) {
                  setBatteryCode(fuzzyResult?.rawMatch || decodedText);
                  setIsScanning(false);
                  setIsFlashOn(false);
                }
              },
              () => {}
            );
          }

          if (!isMounted) {
            html5QrCode.stop().catch(() => {});
            return;
          }

          // Check for zoom capabilities
          try {
            if (html5QrCode && typeof (html5QrCode as any).getRunningTrack === 'function') {
              const runningTrack = (html5QrCode as any).getRunningTrack();
              if (runningTrack) {
                const capabilities = runningTrack.getCapabilities() as any;
                const settings = runningTrack.getSettings() as any;
                if (capabilities.zoom) {
                  setHasZoom(true);
                  setMinZoom(capabilities.zoom.min || 1);
                  setMaxZoom(capabilities.zoom.max || 1);
                  setZoomLevel(settings.zoom || capabilities.zoom.min || 1);
                }
              }
            }
          } catch (zoomErr) {
            console.warn("Zoom capabilities check failed:", zoomErr);
          }

          // Start auto analysis
          const runAutoAnalysis = async () => {
            if (!isMounted || !isScanning) return;
            await captureAndOCR(true);
            if (isMounted && isScanning) {
              ocrTimerRef.current = setTimeout(runAutoAnalysis, 1500);
            }
          };
          analysisTimeout = setTimeout(runAutoAnalysis, 2000);

        } catch (err: any) {
          console.error("Scanner failure:", err);
          if (isMounted) {
            setScannerError(`فشل الاتصال بالكاميرا: ${err?.message || 'تأكد من الأذونات'}`);
            setIsScanning(false);
          }
        }
      };
      
      startScanner();
    } else {
      setHtml5QrCodeInstance(null);
      setIsFlashOn(false);
    }

    return () => {
      isMounted = false;
      if (analysisTimeout) clearTimeout(analysisTimeout);
      if (ocrTimerRef.current) clearTimeout(ocrTimerRef.current);
      if (html5QrCode && html5QrCode.isScanning) {
        html5QrCode.stop().catch(err => console.error("Cleanup stop error:", err));
      }
    };
  }, [isScanning]);

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-neutral-900 font-sans selection:bg-brand-red/10 overflow-x-hidden" dir="rtl">
      {/* Dynamic Header */}
      <header className="bg-white border-b border-neutral-200 sticky top-0 z-40 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-brand-red rounded-xl flex items-center justify-center shadow-lg shadow-brand-red/20 transition-transform hover:scale-105">
            <Zap size={22} className="text-white" />
          </div>
          <div>
            <h1 className="text-lg font-black tracking-tight leading-none">إيـجـل</h1>
            <p className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest mt-1">Smarter Battery Analysis</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
           <button 
             onClick={() => setResearchPageId('chemistry')}
             className="hidden md:flex items-center gap-2 px-4 py-2 bg-neutral-900 text-white rounded-lg text-xs font-black shadow-lg hover:bg-black transition-all active:scale-95"
           >
             <BookOpen size={16} />
             موسوعة المعرفة
           </button>
           <button 
             onClick={handleClear}
             className="w-10 h-10 flex items-center justify-center text-neutral-400 hover:text-brand-red hover:bg-neutral-50 rounded-xl transition-all"
             title="مسح البيانات"
           >
             <Trash2 size={20} />
           </button>
        </div>
      </header>

      <div className="max-w-[1440px] mx-auto px-4 md:px-10 py-6 md:py-10">
        <div className="flex flex-col lg:flex-row gap-8 items-start">
          
          {/* Main Content Area */}
          <main className="flex-1 w-full space-y-8">
            
            {/* Intelligent Diagnostic Scanner */}
            <Section title="تحليل الكود الذكي" icon={<Cpu className="text-brand-red" />}>
              <div className="space-y-6">
                <div className="flex flex-col md:flex-row gap-4">
                  <div className="flex-1 flex gap-2">
                    <div className="relative flex-1">
                      <input 
                        type="text"
                        placeholder="أدخل الكود يدوياً أو استخدم الماسح"
                        value={batteryCode}
                        onChange={(e) => setBatteryCode(e.target.value)}
                        className="w-full h-14 bg-neutral-50 border-2 border-neutral-100 rounded-xl px-4 pr-12 text-sm font-bold tracking-widest uppercase focus:border-brand-red focus:bg-white focus:outline-none transition-all shadow-sm"
                      />
                      <Search size={18} className="absolute right-4 top-1/2 -translate-y-1/2 text-neutral-300" />
                    </div>
                    <div className="flex gap-2">
                      <button 
                        onClick={toggleScanner}
                        className={`h-14 w-14 rounded-xl flex items-center justify-center shadow-lg transition-all active:scale-90 ${isScanning ? 'bg-black text-white' : 'bg-brand-red text-white hover:bg-brand-red/90 group'}`}
                      >
                        {isScanning ? <Trash2 size={24} /> : <Camera size={24} className="group-hover:rotate-12 transition-transform" />}
                      </button>
                      <label className="h-14 w-14 rounded-xl flex items-center justify-center bg-blue-600 text-white shadow-lg shadow-blue-200 transition-all active:scale-90 hover:bg-blue-700 cursor-pointer group" title="تحميل صورة من المعرض">
                        <Image size={24} className="group-hover:-translate-y-1 transition-transform" />
                        <input type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
                      </label>
                    </div>
                  </div>
                </div>

                <AnimatePresence>
                    {isScanning && (
                      <motion.div 
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        className="relative rounded-3xl overflow-hidden bg-black aspect-square md:aspect-[16/10] border-4 border-neutral-900 group shadow-2xl ring-8 ring-brand-red/5"
                      >
                        <div id="reader" className="w-full h-full [&_video]:object-cover"></div>
                        
                        {/* Shutter Animation Overlay */}
                        <AnimatePresence>
                          {shutterEffect && (
                            <motion.div 
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              exit={{ opacity: 0 }}
                              className="absolute inset-0 bg-white z-[60]"
                            />
                          )}
                        </AnimatePresence>
                        
                        {/* Scanning Viewport / Bounding Box */}
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
                            <div className="relative w-[90%] max-w-[600px] h-64 md:h-[350px] border border-white/5 rounded-3xl bg-white/[0.02] backdrop-blur-[1px]">
                               {/* Animated Highlight Corners */}
                               <div className="absolute -top-[2px] -left-[2px] w-12 h-12 border-t-[5px] border-l-[5px] border-brand-red rounded-tl-2xl shadow-[-10px_-10px_20px_rgba(239,68,68,0.3)]" />
                               <div className="absolute -top-[2px] -right-[2px] w-12 h-12 border-t-[5px] border-r-[5px] border-brand-red rounded-tr-2xl shadow-[10px_-10px_20px_rgba(239,68,68,0.3)]" />
                               <div className="absolute -bottom-[2px] -left-[2px] w-12 h-12 border-b-[5px] border-l-[5px] border-brand-red rounded-bl-2xl shadow-[-10px_10px_20px_rgba(239,68,68,0.3)]" />
                               <div className="absolute -bottom-[2px] -right-[2px] w-12 h-12 border-b-[5px] border-r-[5px] border-brand-red rounded-br-2xl shadow-[10px_10px_20px_rgba(239,68,68,0.3)]" />

                               {/* Scanning Blade (Laser) */}
                               <motion.div 
                                 animate={{ 
                                   top: ['5%', '95%', '5%'],
                                   opacity: [0.2, 0.8, 0.2]
                                 }}
                                 transition={{ 
                                   duration: 3, 
                                   repeat: Infinity, 
                                   ease: "easeInOut" 
                                 }}
                                 className="absolute left-6 right-6 h-1 w-auto bg-gradient-to-r from-transparent via-brand-red to-transparent z-10"
                               >
                                 <div className="absolute inset-0 blur-md bg-brand-red/50" />
                               </motion.div>

                               {/* Text Label */}
                               <div className="absolute -bottom-10 left-0 right-0 text-center">
                                  <span className="text-[10px] font-black text-white/40 uppercase tracking-[0.2em] animate-pulse">
                                    Align Battery Code Within Frame
                                  </span>
                               </div>
                            </div>
                        </div>

                        {/* Top Control Bar with Environmental Feedback */}
                        <div className="absolute top-4 right-4 left-4 flex justify-between items-start z-40">
                           {/* Left Side: Environment Lab */}
                           <div className="flex flex-col gap-1.5 focus-guide">
                              <div className={`flex items-center gap-1.5 bg-black/60 backdrop-blur-md px-3 py-1 rounded-full border ${isTooDark ? 'border-amber-500/50 shadow-[0_0_10px_rgba(245,158,11,0.2)]' : isTooBright ? 'border-orange-500/50' : 'border-emerald-500/30'}`}>
                                <div className={`w-1.5 h-1.5 rounded-full ${isTooDark ? 'bg-amber-500' : isTooBright ? 'bg-orange-500' : 'bg-emerald-500'} animate-pulse`} />
                                <span className="text-[10px] font-black text-white uppercase tracking-wider">
                                  Lighting: {isTooDark ? 'LOW' : isTooBright ? 'HIGH' : 'OPTIMAL'}
                                </span>
                              </div>
                              
                              <AnimatePresence>
                                {isTooDark && (
                                  <motion.div 
                                    initial={{ opacity: 0, x: -10 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    exit={{ opacity: 0, x: -10 }}
                                    className="bg-amber-500 text-black px-2 py-0.5 rounded text-[8px] font-black uppercase flex items-center gap-1 w-fit"
                                  >
                                    <Zap size={8} fill="black" /> Turn on flash for better OCR
                                  </motion.div>
                                )}
                              </AnimatePresence>
                           </div>
                           
                           {/* Right Side: Flash & AI Meter */}
                           <div className="flex flex-col items-end gap-2">
                              <button 
                                onClick={(e) => { e.stopPropagation(); toggleFlash(); }}
                                className={`w-10 h-10 rounded-full flex items-center justify-center backdrop-blur-xl transition-all active:scale-90 border overflow-hidden ${isFlashOn ? 'bg-amber-500 border-amber-400 text-white shadow-[0_0_20px_rgba(245,158,11,0.5)]' : 'bg-black/40 border-white/20 text-white'}`}
                              >
                                <Zap size={16} fill={isFlashOn ? "currentColor" : "none"} />
                              </button>
                              
                              <div className="bg-black/60 backdrop-blur-md px-2 py-1 rounded border border-white/10 flex flex-col items-center">
                                 <div className="text-[6px] font-black text-white/40 uppercase mb-0.5 leading-none">ANALYSIS GAIN</div>
                                 <div className="h-1 w-12 bg-neutral-800 rounded-full overflow-hidden">
                                    <motion.div 
                                      className="h-full bg-brand-red"
                                      animate={{ width: `${Math.min(100, Math.max(15, brightness / 2.55))}%` }}
                                    />
                                 </div>
                              </div>
                           </div>
                        </div>

                        {/* Zoom Controls Overlay */}
                        <AnimatePresence>
                          {isScanning && hasZoom && maxZoom > minZoom && (
                            <motion.div 
                              initial={{ opacity: 0, x: -20 }}
                              animate={{ opacity: 1, x: 0 }}
                              exit={{ opacity: 0, x: -20 }}
                              className="absolute left-4 top-1/2 -translate-y-1/2 z-40 flex flex-col items-center gap-4 py-6 px-3 bg-black/40 backdrop-blur-xl rounded-full border border-white/10"
                            >
                               <button 
                                 onClick={() => handleZoomChange(Math.min(maxZoom, zoomLevel + 0.5))}
                                 className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-white/20 transition-all active:scale-90"
                               >
                                 <Plus size={18} />
                               </button>
                               
                               <div className="relative h-40 w-1">
                                  <input 
                                    type="range"
                                    min={minZoom}
                                    max={maxZoom}
                                    step={0.1}
                                    value={zoomLevel}
                                    onChange={(e) => handleZoomChange(parseFloat(e.target.value))}
                                    className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-40 h-2 -rotate-90 appearance-none bg-neutral-700 rounded-full cursor-pointer overflow-hidden accent-brand-red"
                                  />
                               </div>

                               <button 
                                 onClick={() => handleZoomChange(Math.max(minZoom, zoomLevel - 0.5))}
                                 className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-white/20 transition-all active:scale-90"
                               >
                                 <Minus size={18} />
                               </button>
                               
                               <div className="bg-brand-red px-2 py-1 rounded text-[8px] font-black text-white">
                                 {zoomLevel.toFixed(1)}x
                               </div>
                            </motion.div>
                          )}
                        </AnimatePresence>

                        {/* Bottom Trigger Controls */}
                        <div className="absolute bottom-4 left-4 right-4 flex justify-center z-30 gap-2">
                          <button 
                            onClick={() => setIsScanning(false)}
                            className="flex-1 h-10 bg-black/40 backdrop-blur-xl text-white rounded-xl flex items-center justify-center gap-2 border border-white/10 hover:bg-red-500/20 hover:border-red-500/40 transition-all active:scale-95 group"
                          >
                            <Trash2 size={16} className="group-hover:scale-110 transition-transform" />
                            <span className="text-[8px] font-black uppercase tracking-widest">إغلاق</span>
                          </button>
                          
                          <button 
                            onClick={() => captureAndOCR(false)}
                            className="flex-[2] h-10 bg-brand-red/90 backdrop-blur-xl text-white rounded-xl flex items-center justify-center gap-2 border border-brand-red/20 hover:bg-brand-red transition-all active:scale-95 group shadow-lg shadow-brand-red/20"
                          >
                            <Camera size={16} className="group-hover:scale-110 transition-transform" />
                            <span className="text-[8px] font-black uppercase tracking-widest">التقاط وتحليل عميق</span>
                          </button>
                        </div>

                        {/* Light Hint Overlay */}
                        <div className="absolute inset-x-0 bottom-24 text-center pointer-events-none px-10">
                           <motion.p 
                             animate={{ opacity: [0.3, 0.6, 0.3] }}
                             transition={{ duration: 2, repeat: Infinity }}
                             className="text-[9px] font-black text-white uppercase tracking-[0.3em] font-mono leading-relaxed"
                           >
                            جاري فحص الكود والأسطر العلوية تلقائياً...
                           </motion.p>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                {scannerError && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="p-4 bg-red-50 border border-red-100 rounded-xl flex items-center gap-3 text-red-600">
                    <AlertTriangle size={18} />
                    <p className="text-xs font-bold">{scannerError}</p>
                  </motion.div>
                )}

                {decodedData && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }} 
                    animate={{ opacity: 1, y: 0 }}
                    className="grid grid-cols-2 md:grid-cols-4 gap-3"
                  >
                    {[
                      { label: 'الطراز المكتشف', value: decodedData.model, icon: <Battery size={14} /> },
                      { label: 'تاريخ الإنتاج', value: `${decodedData.day} ${decodedData.month} ${decodedData.year}`, icon: <Calendar size={14} /> },
                      { label: 'الوردية العارضة', value: decodedData.shift, icon: <Clock size={14} /> },
                      { label: 'خط الإنتاج', value: decodedData.line, icon: <Factory size={14} /> }
                    ].map((item, i) => (
                      <div key={i} className="bg-neutral-50 p-4 rounded-2xl border border-neutral-100 transition-all hover:border-brand-red/20 group">
                        <div className="flex items-center gap-2 text-neutral-400 mb-2">
                           {item.icon}
                           <span className="text-[9px] font-black uppercase tracking-tighter">{item.label}</span>
                        </div>
                        <p className="text-sm font-black text-neutral-800 uppercase group-hover:text-brand-red transition-colors">{item.value}</p>
                      </div>
                    ))}
                  </motion.div>
                )}
              </div>
            </Section>

            {/* Filling Acid Section */}
            <Section title="مرحلة ملئ الحمض" icon={<Droplets className="text-blue-500" />}>
              <div className="space-y-6">
                <div className="flex items-center justify-between p-4 bg-blue-50/50 rounded-2xl border border-blue-100">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                      <Droplets size={16} className="text-blue-500" />
                    </div>
                    <div>
                      <p className="text-xs font-black text-neutral-800">تفعيل القسم</p>
                      <p className="text-[10px] text-neutral-400 font-medium">قم بتفعيل القسم في حالة ملئ البطارية الجافة</p>
                    </div>
                  </div>
                  <Toggle 
                    enabled={data.fillingAcid.enabled} 
                    onToggle={(v) => handleUpdate('fillingAcid', 'enabled', v)} 
                  />
                </div>

                <AnimatePresence>
                  {data.fillingAcid.enabled && (
                    <motion.div 
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="space-y-6 overflow-hidden"
                    >
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <Dropdown 
                          label="طراز البطارية" 
                          value={data.fillingAcid.model} 
                          onChange={(v) => handleUpdate('fillingAcid', 'model', v)} 
                        />
                        <Input 
                          label="الكثافة الملموسة" 
                          placeholder="1.250" 
                          value={data.fillingAcid.density} 
                          onChange={(v) => handleUpdate('fillingAcid', 'density', v)} 
                        />
                        <Input 
                          label="حرارة الحمض" 
                          placeholder="25" 
                          value={data.fillingAcid.temp} 
                          onChange={(v) => handleUpdate('fillingAcid', 'temp', v)} 
                          quickValues={['25', '30', '35']}
                        />
                      </div>
                      <RecommendationBox 
                        section="fillingAcid" 
                        density={data.fillingAcid.density} 
                        temp={data.fillingAcid.temp}
                        onLearnMore={(id) => setResearchPageId(id)}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </Section>

            {/* Main Testing Sections */}
            <div className="grid grid-cols-1 gap-8">
              <Section title="فحص ما بعد الشحن" icon={<Zap className="text-amber-500" />}>
                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <Dropdown label="طراز البطارية" value={data.afterCharging.model} onChange={(v) => handleUpdate('afterCharging', 'model', v)} />
                    <Input label="كثافة الحمض" placeholder="1.285" value={data.afterCharging.density} onChange={(v) => handleUpdate('afterCharging', 'density', v)} />
                    <Input label="حرارة البطارية" placeholder="40" value={data.afterCharging.temp} onChange={(v) => handleUpdate('afterCharging', 'temp', v)} quickValues={['35', '40', '45']} />
                  </div>
                  <RecommendationBox section="afterCharging" density={data.afterCharging.density} temp={data.afterCharging.temp} onLearnMore={(id) => setResearchPageId(id)} />
                </div>
              </Section>

              <Section title="مرحلة ضبط المستوى" icon={<Settings2 className="text-emerald-500" />}>
                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <Input label="الكثافة النهائية" placeholder="1.265" value={data.levelAdjustment.density} onChange={(v) => handleUpdate('levelAdjustment', 'density', v)} />
                    <Input label="الحرارة النهائية" placeholder="25" value={data.levelAdjustment.temp} onChange={(v) => handleUpdate('levelAdjustment', 'temp', v)} quickValues={['20', '25', '30']} />
                  </div>
                  <RecommendationBox section="levelAdjustment" density={data.levelAdjustment.density} temp={data.levelAdjustment.temp} onLearnMore={(id) => setResearchPageId(id)} />
                </div>
              </Section>

              <Section title="الكثافة العامة والنهائية" icon={<Plus className="text-neutral-900" />}>
                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <Dropdown label="الطراز" value={data.generalDensity.model} onChange={(v) => handleUpdate('generalDensity', 'model', v)} />
                    <Input label="قراءة الكثافة" placeholder="1.280" value={data.generalDensity.density} onChange={(v) => handleUpdate('generalDensity', 'density', v)} />
                    <Input label="قراءة الحرارة" placeholder="25" value={data.generalDensity.temp} onChange={(v) => handleUpdate('generalDensity', 'temp', v)} quickValues={['25', '28', '32']} />
                  </div>
                </div>
              </Section>
            </div>
          </main>

          {/* Sidebar: Diagnostics & Reporting */}
          <aside className="w-full lg:w-[420px] lg:sticky lg:top-28 space-y-6">
            <div className="bg-white rounded-3xl shadow-xl shadow-neutral-200/50 border border-neutral-100 overflow-hidden transform transition-all">
               <div className="bg-neutral-900 p-6 text-white relative overflow-hidden">
                 <div className="absolute top-0 right-0 w-32 h-32 bg-brand-red/10 blur-[60px] -mr-16 -mt-16" />
                 <div className="relative z-10">
                   <h3 className="text-sm font-black text-brand-red uppercase tracking-widest mb-1">ملخص التشخيص</h3>
                   <div className="flex items-end gap-2">
                     <span className="text-4xl font-black">{getBatteryDiagnosis(data.generalDensity.density, data.generalDensity.temp).soc}%</span>
                     <span className="text-xs font-bold text-white/40 mb-2">SOC (حالة الشحن)</span>
                   </div>
                 </div>
               </div>
               
               <div className="p-6 space-y-6">
                 <div className="space-y-2">
                   <div className="flex justify-between items-center px-1">
                     <span className={`text-xs font-black uppercase tracking-tight ${getBatteryDiagnosis(data.generalDensity.density, data.generalDensity.temp).color}`}>
                       {getBatteryDiagnosis(data.generalDensity.density, data.generalDensity.temp).message}
                     </span>
                     <span className="text-[10px] font-bold text-neutral-400">تحليل فوري</span>
                   </div>
                   <div className="h-3 bg-neutral-100 rounded-full overflow-hidden p-0.5 shadow-inner">
                     <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: `${getBatteryDiagnosis(data.generalDensity.density, data.generalDensity.temp).soc}%` }}
                        className={`h-full rounded-full transition-all duration-1000 ${
                          getBatteryDiagnosis(data.generalDensity.density, data.generalDensity.temp).status === 'excellent' ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.3)]' :
                          getBatteryDiagnosis(data.generalDensity.density, data.generalDensity.temp).status === 'good' ? 'bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.3)]' :
                          getBatteryDiagnosis(data.generalDensity.density, data.generalDensity.temp).status === 'warning' ? 'bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.3)]' : 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.3)]'
                        }`}
                     />
                   </div>
                 </div>
                 
                 <div className="bg-neutral-50 p-4 rounded-xl border border-neutral-200/50 flex gap-3 items-start">
                   <div className={`mt-0.5 p-1 rounded-md ${getBatteryDiagnosis(data.generalDensity.density, data.generalDensity.temp).status === 'excellent' ? 'bg-emerald-100' : 'bg-brand-red/10'}`}>
                     <CheckCircle2 size={14} className={getBatteryDiagnosis(data.generalDensity.density, data.generalDensity.temp).color} />
                   </div>
                   <div className="space-y-1">
                     <p className="text-[10px] text-neutral-400 font-black mb-1 uppercase tracking-wider">البروتوكول المقترح:</p>
                     <p className="text-[12px] text-neutral-800 font-bold leading-relaxed">
                       {getBatteryDiagnosis(data.generalDensity.density, data.generalDensity.temp).action}
                     </p>
                   </div>
                 </div>

                 <div className="pt-4 border-t border-neutral-100">
                    <p className="text-[10px] font-black text-neutral-400 uppercase tracking-widest mb-3">معاينة نص التقرير:</p>
                    <div className="bg-neutral-50 p-4 rounded-2xl border border-neutral-100">
                      <pre className="text-xs font-mono text-neutral-600 whitespace-pre-wrap text-right leading-relaxed">
                        {previewText || 'بانتظار البيانات...'}
                      </pre>
                    </div>
                 </div>
               </div>
            </div>

            {/* Mobile App Instruction */}
            <div className="px-6 py-3 bg-neutral-50 border-t border-neutral-200">
              <div className="flex items-center gap-2 text-[10px] text-neutral-500 font-medium italic">
                <Info size={12} className="text-neutral-400" />
                <span>لتحويل البرنامج لتطبيق APK: اضغط على (إضافة إلى الشاشة الرئيسية) في متصفحك.</span>
              </div>
            </div>

            <div className="p-4 md:p-6 bg-white/95 backdrop-blur-xl border-t border-black/10 shadow-[0_-10px_30px_rgba(0,0,0,0.1)] space-y-3">
              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  onClick={copyToClipboard}
                  className={`flex-1 py-4 rounded-xl border-2 font-bold flex items-center justify-center gap-2 transition-all ${
                    copied 
                    ? 'bg-neutral-900 border-neutral-900 text-white' 
                    : 'bg-white border-neutral-200 text-neutral-600 hover:border-neutral-400 active:scale-95'
                  }`}
                >
                  {copied ? <Check size={20} /> : <Copy size={20} />}
                  <span>{copied ? 'تم النسخ' : 'نسخ التقرير'}</span>
                </button>
                
                <button
                  onClick={sendToWhatsApp}
                  className={`flex-[1.5] py-4 rounded-xl flex items-center justify-center gap-3 font-bold text-white shadow-xl active:scale-95 transition-all ${
                    validated 
                    ? 'bg-[#25D366] hover:bg-[#20bd5a] shadow-[#25D366]/40' 
                    : 'bg-neutral-300 shadow-none cursor-not-allowed text-neutral-500'
                  }`}
                >
                  <Send size={20} />
                  <span>إرسال عبر واتساب</span>
                </button>
              </div>
            </div>
          </aside>
        </div>
      </div>
      
      {/* Mobile Floating Action Bar */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 p-4 bg-white/80 backdrop-blur-xl border-t border-black/5 z-50 flex gap-2">
        <button
          onClick={copyToClipboard}
          className={`h-14 rounded-2xl border-2 font-bold flex items-center justify-center transition-all ${
            copied 
            ? 'bg-black border-black text-white px-8' 
            : 'bg-white border-neutral-200 text-neutral-600 px-4 active:scale-95'
          }`}
        >
          {copied ? <Check size={20} /> : <Copy size={20} />}
        </button>
        
        <button
          onClick={sendToWhatsApp}
          className={`flex-1 h-14 rounded-2xl flex items-center justify-center gap-3 font-bold text-white shadow-xl active:scale-95 transition-all ${
            validated 
            ? 'bg-[#25D366] hover:bg-[#20bd5a] shadow-[#25D366]/40' 
            : 'bg-neutral-300 shadow-none cursor-not-allowed text-neutral-500'
          }`}
        >
          <Send size={20} />
          <span>إرسال التقرير</span>
        </button>
      </div>

      {/* Research Modal Overlay */}
      <AnimatePresence>
        {researchPageId && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4 md:p-12"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="w-full max-w-5xl h-full"
            >
              <ResearchBook 
                initialPageId={researchPageId} 
                onClose={() => setResearchPageId(null)} 
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Hidden Scanner for file processing */}
      <div id="reader-hidden" className="hidden"></div>
      
      {/* Global Processing Overlay */}
      <AnimatePresence>
        {isProcessing && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-neutral-900/90 backdrop-blur-md z-[100] flex flex-col items-center justify-center p-8 text-center"
          >
            <div className="relative">
              <motion.div 
                animate={{ rotate: 360 }}
                transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
                className="w-24 h-24 border-4 border-white/5 border-t-brand-red rounded-full shadow-[0_0_50px_rgba(239,68,68,0.3)]"
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <Cpu size={32} className="text-white animate-pulse" />
              </div>
            </div>
            <h3 className="text-white text-xl font-black mt-8 mb-2 tracking-tight">جاري التحليل الذكي للبيانات</h3>
            <p className="text-white/40 text-xs font-bold uppercase tracking-widest leading-relaxed max-w-xs">
              نحاول استخراج الكود المحفور باستخدام تقنية OCR المتقدمة. يرجى الانتظار قليلاً...
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Section({ title, icon, children }: { title: string, icon: React.ReactNode, children: React.ReactNode }) {
  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      className="bg-white rounded-2xl border border-neutral-100 shadow-md overflow-hidden"
    >
      <div className="px-6 py-4 bg-neutral-50/50 border-b border-neutral-100 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-white rounded-lg shadow-sm border border-neutral-100">
            {icon}
          </div>
          <h2 className="font-bold text-neutral-800 text-lg">{title}</h2>
        </div>
      </div>
      <div className="p-6">
        {children}
      </div>
    </motion.div>
  );
}

function Toggle({ enabled, onToggle }: { enabled: boolean, onToggle: (val: boolean) => void }) {
  return (
    <button 
      onClick={() => onToggle(!enabled)}
      className={`w-14 h-8 rounded-full relative transition-all duration-300 ease-in-out shadow-inner ${enabled ? 'bg-brand-red shadow-brand-red/20' : 'bg-neutral-200'}`}
    >
      <div className={`absolute top-1 w-6 h-6 bg-white rounded-full shadow-lg transition-all duration-300 transform ${enabled ? 'translate-x-[-32px]' : 'translate-x-[-4px]'}`} />
    </button>
  );
}

function Input({ label, placeholder, value, onChange, quickValues }: { label: string, placeholder: string, value: string, onChange: (v: string) => void, quickValues?: string[] }) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (val === '' || /^[0-9]*\.?[0-9]*$/.test(val)) {
      onChange(val);
    }
  };

  return (
    <div className="space-y-2 flex-1 group">
      <label className="text-[11px] font-black text-neutral-400 uppercase tracking-[0.1em] px-1">{label}</label>
      <div className="relative">
        <input
          type="text"
          inputMode="decimal"
          value={value}
          onChange={handleChange}
          placeholder={placeholder}
          className="w-full h-14 bg-neutral-50 border-2 border-neutral-100 rounded-xl px-4 text-lg font-bold focus:border-brand-red focus:bg-white focus:outline-none focus:ring-8 focus:ring-brand-red/5 transition-all text-right shadow-sm placeholder:text-neutral-300"
        />
        {value && (
          <button 
            onClick={() => onChange('')}
            className="absolute left-3 top-1/2 -translate-y-1/2 w-8 h-8 bg-neutral-200/50 hover:bg-neutral-200 rounded-full flex items-center justify-center text-neutral-500 transition-colors"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>
      {quickValues && (
        <div className="flex flex-wrap gap-2 pt-1">
          {quickValues.map(q => (
            <button 
              key={q}
              onClick={() => onChange(q)}
              className="text-xs px-3 py-1.5 bg-white border border-neutral-200 hover:border-brand-red hover:text-brand-red rounded-lg font-bold transition-all shadow-sm active:scale-95"
            >
              {q}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Dropdown({ label, value, onChange }: { label: string, value: string, onChange: (v: string) => void }) {
  return (
    <div className="space-y-2 relative flex-1">
      <label className="text-[11px] font-black text-neutral-400 uppercase tracking-[0.1em] px-1">{label}</label>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full h-14 bg-neutral-50 border-2 border-neutral-100 rounded-xl px-4 pr-10 text-lg font-bold appearance-none focus:border-brand-red focus:bg-white focus:outline-none transition-all text-right rtl-select shadow-sm"
        >
          <option value="">اختر الطراز...</option>
          {BATTERY_MODELS.map(m => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <div className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none text-neutral-400">
          <ChevronDown size={20} />
        </div>
      </div>
    </div>
  );
}

function TipCard({ title, content }: { title: string, content: string }) {
  return (
    <div className="bg-white p-4 rounded-xl border border-neutral-200 shadow-sm flex gap-3">
      <div className="h-6 w-6 mt-1 flex-shrink-0 bg-brand-red/10 rounded-full flex items-center justify-center">
        <Check size={12} className="text-brand-red" />
      </div>
      <div className="space-y-1">
        <h4 className="font-bold text-sm text-neutral-800">{title}</h4>
        <p className="text-xs text-neutral-500 leading-relaxed">{content}</p>
      </div>
    </div>
  );
}
