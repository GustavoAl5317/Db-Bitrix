import { initBitrix, getTasks } from './bitrix24.js';
import { insertData } from './database.js';

// Inicia a integração com o Bitrix24
initBitrix();

// Obtém tarefas e insere no banco de dados
function fetchAndInsertTasks(params = 30) {
    getTasks(params).then(tasks => {
        tasks.forEach(task => {
            insertData(task);
        });
    }).catch(error => {
        console.error("Erro ao buscar tarefas:", error);
    });
}

// Chama a função para buscar e inserir tarefas
fetchAndInsertTasks();
