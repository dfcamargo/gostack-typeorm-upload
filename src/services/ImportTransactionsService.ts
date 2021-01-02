import { getRepository } from 'typeorm';
import csvParse from 'csv-parse';
import fs from 'fs';
import path from 'path';

import uploadConfig from '../config/upload';

import Transaction from '../models/Transaction';
import Category from '../models/Category';

interface Request {
  title: string;
  value: number;
  type: 'income' | 'outcome';
  category: string;
}

class ImportTransactionsService {
  private async loadCSV(csvFilePath: string): Promise<Request[]> {
    const readCsvStream = fs.createReadStream(csvFilePath);

    const parseStream = csvParse({
      from_line: 2,
      ltrim: true,
      rtrim: true,
      columns: ['title', 'type', 'value', 'category'],
    });

    const parseCsv = readCsvStream.pipe(parseStream);

    const lines: Request[] = [];

    parseCsv.on('data', ({ title, type, value, category }: Request) => {
      if (!title || !type || !value) return;

      lines.push({ title, type, value, category });
    });

    await new Promise(resolve => {
      parseCsv.on('end', resolve);
    });

    return lines;
  }

  async execute(filename: string): Promise<Transaction[]> {
    const csvFilePath = path.join(uploadConfig.directory, filename);

    const lines = await this.loadCSV(csvFilePath);

    const transactionsRepository = getRepository(Transaction);
    const categoriesRepository = getRepository(Category);

    const categoriesExists = await categoriesRepository.find();

    const categoriesTitleExists = categoriesExists.map(({ title }) => title);

    const categories = lines
      .map(({ category }) => category)
      .filter(category => !categoriesTitleExists.includes(category))
      .filter((value, index, self) => self.indexOf(value) === index);

    const addTransactionCategory = categoriesRepository.create(
      categories.map(title => ({ title })),
    );

    await categoriesRepository.save(addTransactionCategory);

    const allCategories = [...categoriesExists, ...addTransactionCategory];

    const transactions = transactionsRepository.create(
      lines.map(line => {
        return {
          title: line.title,
          value: line.value,
          type: line.type,
          category: allCategories.find(
            category => category.title === line.category,
          ),
        };
      }),
    );

    await transactionsRepository.save(transactions);

    await fs.promises.unlink(csvFilePath);

    return transactions;
  }
}

export default ImportTransactionsService;
